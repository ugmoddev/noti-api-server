// ============================================
// IMPORTS
// ============================================
const express = require("express")
const crypto = require("crypto")
const compression = require("compression")
const cors = require("cors")
const http = require("http")
const https = require("https")
const WebSocket = require("ws")
const { spawn, execSync } = require("child_process")
const fs = require("fs")
const multer = require("multer")
const path = require("path")

// ============================================
// CONFIGURATION
// ============================================
const config = {
    port: process.env.PORT || 3000,
    ownerToken: process.env.OWNER_TOKEN,
    githubToken: process.env.GITHUB_TOKEN,
    githubRepo: process.env.GITHUB_REPO,
    githubBranch: process.env.GITHUB_BRANCH || "main",
    encryptionKey: process.env.ENCRYPTION_KEY || "",
    maxChatMessages: 300,
    maxBotLogs: 500,
    maxMonitorHistory: 60,
    botLimitUser: 1,
    botMaxRestarts: 5,
    botRestartDelay: 15000,
    dbPath: "db.json",
    dbBackupPath: "db.backup.json",
    botDbPath: "db_bots.json",
    botDbBackupPath: "db_bots.backup.json"
}

// Validate required config
if (!config.ownerToken) throw new Error("Missing OWNER_TOKEN")
if (!config.githubToken || !config.githubRepo) throw new Error("Missing GITHUB config")

// ============================================
// DATABASE CLASS
// ============================================
class Database {
    constructor() {
        this.data = { apis: {}, users: {}, sessions: {}, bots: {}, monitors: {} }
        this.fileSha = {}
        this.writeQueue = Promise.resolve()
        this.pendingWrite = false
        this.saveTimeout = null
        this.localDbPath = "/tmp/db_local.json"
    }

    // Encryption
    encrypt(text) {
        if (!config.encryptionKey) return text
        const key = crypto.createHash("sha256").update(config.encryptionKey).digest()
        const iv = crypto.randomBytes(16)
        const cipher = crypto.createCipheriv("aes-256-cbc", key, iv)
        let enc = cipher.update(text, "utf8", "base64")
        enc += cipher.final("base64")
        return iv.toString("base64") + ":" + enc
    }

    decrypt(text) {
        if (!config.encryptionKey) return text
        const parts = text.split(":")
        if (parts.length !== 2) return text
        try {
            const key = crypto.createHash("sha256").update(config.encryptionKey).digest()
            const iv = Buffer.from(parts[0], "base64")
            const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv)
            let dec = decipher.update(parts[1], "base64", "utf8")
            dec += decipher.final("utf8")
            return dec
        } catch (e) {
            return null
        }
    }

    // GitHub operations
    async fetchFile(filePath) {
        const url = `https://api.github.com/repos/${config.githubRepo}/contents/${filePath}?ref=${config.githubBranch}`
        const res = await fetch(url, {
            headers: {
                Authorization: `token ${config.githubToken}`,
                Accept: "application/vnd.github.v3+json"
            }
        })
        if (!res.ok) return null
        const data = await res.json()
        this.fileSha[filePath] = data.sha
        return this.decrypt(Buffer.from(data.content, "base64").toString("utf8"))
    }

    async getFileSha(filePath) {
        try {
            const url = `https://api.github.com/repos/${config.githubRepo}/contents/${filePath}?ref=${config.githubBranch}`
            const res = await fetch(url, {
                headers: {
                    Authorization: `token ${config.githubToken}`,
                    Accept: "application/vnd.github.v3+json"
                }
            })
            if (!res.ok) return null
            const data = await res.json()
            this.fileSha[filePath] = data.sha
            return data.sha
        } catch { return null }
    }

    async initEmptyRepo() {
        const baseUrl = `https://api.github.com/repos/${config.githubRepo}`
        const headers = {
            Authorization: `token ${config.githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        }
        
        const treeRes = await fetch(`${baseUrl}/git/trees`, {
            method: "POST",
            headers,
            body: JSON.stringify({ tree: [] })
        })
        if (!treeRes.ok) throw new Error("Init tree failed")
        const treeData = await treeRes.json()
        
        const commitRes = await fetch(`${baseUrl}/git/commits`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                message: "init",
                tree: treeData.sha,
                parents: []
            })
        })
        if (!commitRes.ok) throw new Error("Init commit failed")
        const commitData = await commitRes.json()
        
        const refRes = await fetch(`${baseUrl}/git/refs`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                ref: `refs/heads/${config.githubBranch}`,
                sha: commitData.sha
            })
        })
        if (!refRes.ok) throw new Error("Init branch failed")
    }

    async pushFile(filePath, content, retry = true) {
        // Check if branch exists
        const branchCheckUrl = `https://api.github.com/repos/${config.githubRepo}/git/refs/heads/${config.githubBranch}`
        let branchCheck = await fetch(branchCheckUrl, {
            headers: {
                Authorization: `token ${config.githubToken}`,
                Accept: "application/vnd.github.v3+json"
            }
        })
        if (!branchCheck.ok && branchCheck.status === 404) {
            await this.initEmptyRepo()
            await new Promise(r => setTimeout(r, 1000))
        }

        const encrypted = this.encrypt(content)
        const encoded = Buffer.from(encrypted).toString("base64")
        const url = `https://api.github.com/repos/${config.githubRepo}/contents/${filePath}`
        const headers = {
            Authorization: `token ${config.githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        }

        let freshSha = await this.getFileSha(filePath)
        const body = {
            message: `update ${filePath}`,
            content: encoded,
            branch: config.githubBranch
        }
        if (freshSha) body.sha = freshSha

        let res = await fetch(url, {
            method: "PUT",
            headers,
            body: JSON.stringify(body)
        })

        if (res.status === 409 && retry) {
            freshSha = await this.getFileSha(filePath)
            if (freshSha) body.sha = freshSha
            else delete body.sha
            res = await fetch(url, {
                method: "PUT",
                headers,
                body: JSON.stringify(body)
            })
        }

        if (!res.ok) {
            const errText = await res.text().catch(() => res.statusText)
            throw new Error(`Push failed: ${res.status} ${errText}`)
        }

        const data = await res.json()
        this.fileSha[filePath] = data.content.sha
    }

    // Local DB operations
    saveLocal(data) {
        try {
            fs.writeFileSync(this.localDbPath, data, "utf8")
        } catch (e) {}
    }

    loadLocal() {
        try {
            if (fs.existsSync(this.localDbPath)) {
                const raw = fs.readFileSync(this.localDbPath, "utf8")
                if (raw) {
                    const data = JSON.parse(raw)
                    if (this.validate(data)) {
                        this.data = data
                        return true
                    }
                }
            }
        } catch (e) {}
        return false
    }

    validate(data) {
        return data && typeof data === "object" &&
            data.apis && data.users
    }

    merge(data) {
        if (!this.validate(data)) return false
        this.data.apis = data.apis || {}
        this.data.users = data.users || {}
        this.data.sessions = data.sessions || {}
        this.data.monitors = data.monitors || {}
        if (data.bots) this.data.bots = data.bots
        else this.data.bots = this.data.bots || {}
        return true
    }

    // Main load
    async load() {
        try {
            // Try main DB
            let raw = await this.fetchFile(config.dbPath)
            if (raw) {
                const mainData = JSON.parse(raw)
                this.merge(mainData)
                
                // Load bots separately
                const rawBots = await this.fetchFile(config.botDbPath)
                if (rawBots) {
                    const botsData = JSON.parse(rawBots)
                    this.data.bots = botsData.bots || {}
                } else {
                    const rawBotsBackup = await this.fetchFile(config.botDbBackupPath)
                    if (rawBotsBackup) {
                        const botsData = JSON.parse(rawBotsBackup)
                        this.data.bots = botsData.bots || {}
                    }
                }
                return true
            }

            // Try backup
            raw = await this.fetchFile(config.dbBackupPath)
            if (raw) {
                const mainData = JSON.parse(raw)
                this.merge(mainData)
                return true
            }
        } catch (e) {}

        // Try local
        if (this.loadLocal()) return true
        return false
    }

    // Write DB
    async write() {
        const mainData = JSON.stringify({
            apis: this.data.apis,
            users: this.data.users,
            sessions: this.data.sessions,
            monitors: this.data.monitors
        })
        const botsData = JSON.stringify({ bots: this.data.bots })
        
        this.saveLocal(JSON.stringify(this.data))
        
        try {
            await this.pushFile(config.dbBackupPath, mainData)
            await this.pushFile(config.dbPath, mainData)
            await this.pushFile(config.botDbBackupPath, botsData)
            await this.pushFile(config.botDbPath, botsData)
        } catch (e) {
            console.error("GitHub push failed:", e.message)
        }
    }

    // Save with debounce
    save() {
        return new Promise((resolve) => {
            if (this.saveTimeout) clearTimeout(this.saveTimeout)
            this.saveTimeout = setTimeout(() => {
                if (this.pendingWrite) { resolve(); return }
                this.pendingWrite = true
                this.writeQueue = this.writeQueue
                    .then(() => this.write())
                    .finally(() => {
                        this.pendingWrite = false
                        resolve()
                    })
            }, 300)
        })
    }

    // Getters
    get apis() { return this.data.apis }
    get users() { return this.data.users }
    get sessions() { return this.data.sessions }
    get bots() { return this.data.bots }
    get monitors() { return this.data.monitors }

    set bots(value) { this.data.bots = value }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
const utils = {
    genToken: () => crypto.randomBytes(32).toString("hex"),
    genID: () => crypto.randomBytes(6).toString("hex"),
    now: () => Date.now(),
    toBool: v => typeof v === "boolean" ? v :
        (typeof v === "string" ? v.toLowerCase() === "true" || v === "1" : !!v),
    getIP: r => (r.headers["x-forwarded-for"] || "").split(",")[0].trim() || r.socket.remoteAddress,
    genGuest: ip => "Khach" + (ip.replace(/\D/g, "").slice(-5) || Math.floor(Math.random() * 99999)),
    parseEncode: txt => { try { return JSON.parse(txt) } catch { return null } },
    encode: (txt, map) => {
        if (!map) return String(txt)
        return String(txt).split("").map(c => map[c] || c).join("")
    }
}

// ============================================
// JOB MANAGER CLASS
// ============================================
class JobManager {
    constructor(db) {
        this.db = db
        this.globalDefaults = {
            ttl: 60000,
            prefix: "",
            suffix: "",
            encode: null,
            removeDuplicate: false,
            maxJobsPerBoss: 0,
            maxTotalJobs: 0,
            enabled: true,
            privateMode: false,
            whitelistIPs: [],
            jobSort: "desc",
            customFields: null,
            webhookCustom: null
        }
    }

    cleanExpiredJobs(api) {
        const t = utils.now()
        Object.keys(api.jobs).forEach(boss => {
            api.jobs[boss] = api.jobs[boss].filter(j => t - j.t < api.ttl)
            if (!api.jobs[boss].length) delete api.jobs[boss]
        })
    }

    applyLimits(api) {
        if (api.maxTotalJobs > 0) {
            let total = 0
            for (let b in api.jobs) total += api.jobs[b].length
            while (total > api.maxTotalJobs) {
                let oldestBoss = null, oldestTime = Infinity
                for (let b in api.jobs) {
                    if (api.jobs[b].length && api.jobs[b][0].t < oldestTime) {
                        oldestTime = api.jobs[b][0].t
                        oldestBoss = b
                    }
                }
                if (oldestBoss) {
                    api.jobs[oldestBoss].shift()
                    total--
                    if (!api.jobs[oldestBoss].length) delete api.jobs[oldestBoss]
                } else break
            }
        }
        if (api.maxJobsPerBoss > 0) {
            for (let b in api.jobs) {
                while (api.jobs[b].length > api.maxJobsPerBoss) {
                    api.jobs[b].shift()
                }
            }
        }
    }

    injectWebhookData(template, data) {
        if (!template) return null
        try {
            let str = typeof template === "string" ? template : JSON.stringify(template)
            str = str.replace(/\{\{job\}\}/g, String(data.job || ""))
                .replace(/\{\{boss\}\}/g, String(data.boss || ""))
                .replace(/\{\{players\}\}/g, String(data.players || 0))
                .replace(/\{\{sea\}\}/g, String(data.sea || 0))
                .replace(/\{\{time\}\}/g, new Date().toISOString())
            return JSON.parse(str)
        } catch { return null }
    }

    async sendWebhook(url, data, custom) {
        try {
            const payload = custom
                ? (this.injectWebhookData(custom, data) || {
                    content: `Job: ${data.job} | Boss: ${data.boss} | Players: ${data.players} | Sea: ${data.sea}`
                })
                : {
                    embeds: [{
                        title: "New Job Added",
                        color: 65280,
                        fields: [
                            { name: "Boss", value: String(data.boss), inline: true },
                            { name: "Players", value: String(data.players), inline: true },
                            { name: "Sea", value: String(data.sea), inline: true },
                            { name: "JobId", value: String(data.job).slice(0, 1000) }
                        ],
                        timestamp: new Date().toISOString()
                    }]
                }
            await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(8000)
            })
        } catch {}
    }

    filterJobFields(job, fields) {
        if (!fields || !fields.length) return job
        const f = {}
        fields.forEach(k => {
            if (Object.prototype.hasOwnProperty.call(job, k)) f[k] = job[k]
        })
        return f
    }
}

// ============================================
// BOT MANAGER CLASS
// ============================================
class BotManager {
    constructor(db) {
        this.db = db
        this.activeProcesses = new Map()
        this.tmpDir = "/tmp/bot_uploads"
        if (!fs.existsSync(this.tmpDir)) {
            fs.mkdirSync(this.tmpDir, { recursive: true })
        }
    }

    spawn(bot) {
        if (this.activeProcesses.has(bot.id)) return
        
        const code = Buffer.from(bot.code, "base64").toString("utf8")
        const tmpFile = `/tmp/bot_${bot.id}.py`
        fs.writeFileSync(tmpFile, code)
        
        const child = spawn("python3", [tmpFile], {
            env: { ...process.env, ...bot.env }
        })
        
        bot.pid = child.pid
        bot.status = "running"
        bot.updated_at = utils.now()
        this.activeProcesses.set(bot.id, child)
        
        const appendLog = (data) => {
            const lines = String(data).split("\n").filter(Boolean)
            bot.logs.push(...lines)
            if (bot.logs.length > config.maxBotLogs) {
                bot.logs.splice(0, bot.logs.length - config.maxBotLogs)
            }
            this.db.save()
        }
        
        child.stdout.on("data", appendLog)
        child.stderr.on("data", data => appendLog("[ERR] " + data))
        
        child.on("close", (exitCode, signal) => {
            this.activeProcesses.delete(bot.id)
            bot.pid = null
            bot.updated_at = utils.now()
            bot.logs.push(`[EXIT] code=${exitCode} signal=${signal}`)
            
            const currentBot = this.db.bots[bot.id]
            if (!currentBot) {
                try { fs.unlinkSync(tmpFile) } catch {}
                return
            }
            
            if (currentBot.autoRestart &&
                (currentBot.restartCount || 0) < config.botMaxRestarts) {
                currentBot.status = "restarting"
                currentBot.restartCount = (currentBot.restartCount || 0) + 1
                currentBot.logs.push(
                    `[AUTO-RESTART] lan ${currentBot.restartCount}/${config.botMaxRestarts} sau ${config.botRestartDelay / 1000}s...`
                )
                this.db.save()
                
                setTimeout(() => {
                    const b = this.db.bots[bot.id]
                    if (b && b.autoRestart && b.status === "restarting") {
                        b.logs.push(`[RESTART] bat lai...`)
                        this.spawn(b)
                        this.db.save()
                    }
                }, config.botRestartDelay)
            } else {
                currentBot.status = "stopped"
                if (currentBot.autoRestart &&
                    (currentBot.restartCount || 0) >= config.botMaxRestarts) {
                    currentBot.logs.push(`[STOP] Da restart ${config.botMaxRestarts} lan, dung lai.`)
                    currentBot.autoRestart = false
                }
                this.db.save()
            }
            
            try { fs.unlinkSync(tmpFile) } catch {}
        })
        
        child.on("error", err => {
            bot.status = "error"
            bot.logs.push("[ERROR] " + err.message)
            this.activeProcesses.delete(bot.id)
            this.db.save()
        })
    }

    stop(botId) {
        const bot = this.db.bots[botId]
        if (!bot) return false
        
        bot.autoRestart = false
        
        if (bot.status !== "running" && bot.status !== "restarting" || !bot.pid) {
            bot.status = "stopped"
            this.db.save()
            return true
        }
        
        try {
            const child = this.activeProcesses.get(bot.id)
            if (child) {
                child.kill("SIGTERM")
                this.activeProcesses.delete(bot.id)
            } else {
                process.kill(bot.pid, "SIGTERM")
            }
            bot.status = "stopped"
            bot.pid = null
            bot.updated_at = utils.now()
            this.db.save()
            return true
        } catch (e) {
            bot.status = "error"
            this.db.save()
            return false
        }
    }

    delete(botId) {
        const bot = this.db.bots[botId]
        if (!bot) return false
        
        bot.autoRestart = false
        
        if ((bot.status === "running" || bot.status === "restarting") && bot.pid) {
            try {
                const child = this.activeProcesses.get(bot.id)
                if (child) {
                    child.kill("SIGKILL")
                    this.activeProcesses.delete(bot.id)
                } else {
                    process.kill(bot.pid, "SIGKILL")
                }
            } catch {}
        }
        
        delete this.db.bots[botId]
        this.db.save()
        return true
    }
}

// ============================================
// MONITOR MANAGER CLASS
// ============================================
class MonitorManager {
    constructor(db) {
        this.db = db
    }

    async check(monitor) {
        const old = monitor.lastStatus
        const start = utils.now()
        
        try {
            await new Promise((resolve, reject) => {
                const lib = monitor.url.startsWith("https") ? https : http
                const req = lib.request(monitor.url, {
                    method: "GET",
                    timeout: 15000
                }, res => {
                    monitor.lastCode = res.statusCode
                    res.resume()
                    resolve()
                })
                req.on("error", reject)
                req.on("timeout", () => {
                    req.destroy()
                    reject(new Error("timeout"))
                })
                req.end()
            })
            
            monitor.totalChecks = (monitor.totalChecks || 0) + 1
            monitor.goodChecks = (monitor.goodChecks || 0) + 1
            monitor.uptime = ((monitor.goodChecks / monitor.totalChecks) * 100).toFixed(2)
            monitor.lastPing = utils.now() - start
            monitor.lastStatus = "online"
            monitor.lastError = null
            monitor.lastCheck = utils.now()
            monitor.retry = 0
            
            monitor.history = monitor.history || []
            monitor.history.push({ t: utils.now(), s: "on", p: monitor.lastPing })
            if (monitor.history.length > config.maxMonitorHistory) {
                monitor.history.shift()
            }
            
            if (old !== "online" && monitor.webhook) {
                await this.sendWebhook(monitor, "up")
            }
        } catch (err) {
            monitor.retry = (monitor.retry || 0) + 1
            if (monitor.retry < 3) return
            
            monitor.totalChecks = (monitor.totalChecks || 0) + 1
            monitor.uptime = (((monitor.goodChecks || 0) / monitor.totalChecks) * 100).toFixed(2)
            monitor.lastStatus = "offline"
            monitor.lastError = err.message || String(err)
            monitor.lastCheck = utils.now()
            
            monitor.history = monitor.history || []
            monitor.history.push({ t: utils.now(), s: "off", p: 0 })
            if (monitor.history.length > config.maxMonitorHistory) {
                monitor.history.shift()
            }
            
            if (old !== "offline" && monitor.webhook) {
                await this.sendWebhook(monitor, "down")
            }
        }
        
        this.db.save()
    }

    async sendWebhook(monitor, type) {
        try {
            await fetch(monitor.webhook, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    embeds: [{
                        title: type === "up" ? "🟢 Online" : "🔴 Offline",
                        color: type === "up" ? 65280 : 16711680,
                        fields: [
                            { name: "Name", value: monitor.name, inline: true },
                            { name: "URL", value: monitor.url, inline: true },
                            { name: "Uptime", value: monitor.uptime + "%", inline: true },
                            { name: "Ping", value: (monitor.lastPing || 0) + "ms", inline: true }
                        ],
                        timestamp: new Date().toISOString()
                    }]
                }),
                signal: AbortSignal.timeout(8000)
            })
        } catch {}
    }
}

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
class AuthMiddleware {
    constructor(db) {
        this.db = db
    }

    getSession(req) {
        return this.db.sessions[req.headers.authorization]
    }

    getUser(req) {
        return this.getSession(req)?.user
    }

    getRole(req) {
        const s = this.getSession(req)
        if (!s) return "guest"
        if (s.role === "OWNER") return "owner"
        const u = this.db.users[s.user]
        return (u && u.role) ? u.role : "member"
    }

    isOwner(req) {
        return this.getRole(req) === "owner"
    }

    isAdminOrOwner(req) {
        const role = this.getRole(req)
        return role === "owner" || role === "admin"
    }

    // Middleware
    requireAuth(req, res, next) {
        if (!this.getUser(req)) {
            return res.json({ err: "Vui lòng đăng nhập" })
        }
        next()
    }

    requireOwner(req, res, next) {
        if (!this.isOwner(req)) {
            return res.json({ err: "Yêu cầu quyền Owner" })
        }
        next()
    }

    requireAdminOrOwner(req, res, next) {
        if (!this.isAdminOrOwner(req)) {
            return res.json({ err: "Yêu cầu quyền Admin hoặc Owner" })
        }
        next()
    }

    checkApiView(req, api) {
        if (!api.privateMode) return true
        const ip = utils.getIP(req)
        if (api.viewIP && api.viewIP === ip) return true
        if (api.whitelistIPs && api.whitelistIPs.includes(ip)) return true
        return false
    }
}

// ============================================
// CREATE EXPRESS APP
// ============================================
const app = express()
const httpServer = http.createServer(app)

// Initialize managers
const db = new Database()
const jobManager = new JobManager(db)
const botManager = new BotManager(db)
const monitorManager = new MonitorManager(db)
const auth = new AuthMiddleware(db)

// Middleware
app.use(compression())
app.use(cors())
app.use(express.json({ limit: "10mb" }))
app.use(express.static("public"))

// Upload middleware
const upload = multer({
    dest: "/tmp/bot_uploads/",
    limits: { fileSize: 5 * 1024 * 1024 }
})

// ============================================
// API ROUTES
// ============================================

// Auth routes
app.post("/register", async (req, res) => {
    let { user, pass } = req.body
    if (!user || !pass) return res.json({ err: "Thiếu user/pass" })
    if (pass.length < 8) return res.json({ err: "Mật khẩu ít nhất 8 ký tự" })
    if (/\s/.test(user)) return res.json({ err: "Tên không chứa khoảng trắng" })
    if (db.users[user]) return res.json({ err: "Tài khoản đã tồn tại" })
    
    const isFirst = Object.keys(db.users).length === 0
    db.users[user] = {
        pass,
        createdAt: utils.now(),
        role: isFirst ? "owner" : "member",
        avatar: ""
    }
    await db.save()
    res.json({ ok: 1 })
})

app.post("/login", async (req, res) => {
    let { user, pass } = req.body
    
    if (pass === config.ownerToken) {
        let token = utils.genToken()
        if (!db.users[user]) {
            db.users[user] = {
                pass: null,
                createdAt: utils.now(),
                role: "owner",
                avatar: ""
            }
        }
        db.sessions[token] = { user, role: "OWNER" }
        await db.save()
        return res.json({ token, role: "owner" })
    }
    
    let u = db.users[user]
    if (!u || u.pass !== pass) {
        return res.json({ err: "Sai thông tin đăng nhập" })
    }
    
    let token = utils.genToken()
    db.sessions[token] = { user, role: "user" }
    await db.save()
    res.json({ token, role: u.role || "member" })
})

app.post("/logout", async (req, res) => {
    const token = req.headers.authorization
    if (token && db.sessions[token]) {
        delete db.sessions[token]
        await db.save()
        res.json({ ok: 1 })
    } else {
        res.json({ err: "Không có phiên" })
    }
})

app.get("/me", (req, res) => {
    let s = auth.getSession(req)
    if (s) {
        const u = db.users[s.user]
        return res.json({
            user: s.user,
            role: auth.getRole(req),
            avatar: u?.avatar || ""
        })
    }
    res.json({
        guest: utils.genGuest(utils.getIP(req)),
        role: "guest",
        avatar: ""
    })
})

app.post("/set-avatar", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    const { avatar } = req.body
    if (typeof avatar !== "string" || avatar.length > 300) {
        return res.json({ err: "Avatar không hợp lệ" })
    }
    db.users[user] = db.users[user] || {
        pass: null,
        createdAt: utils.now(),
        role: "member",
        avatar: ""
    }
    db.users[user].avatar = avatar
    await db.save()
    res.json({ ok: 1, avatar })
})

app.post("/change-password", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    const { oldPass, newPass } = req.body
    const u = db.users[user]
    if (!u) return res.json({ err: "Không tìm thấy" })
    if (u.pass && u.pass !== oldPass) {
        return res.json({ err: "Sai mật khẩu hiện tại" })
    }
    if (!newPass || newPass.length < 8) {
        return res.json({ err: "Mật khẩu mới quá ngắn" })
    }
    u.pass = newPass
    await db.save()
    res.json({ ok: 1 })
})

app.get("/user/:username", (req, res) => {
    const u = db.users[req.params.username]
    if (!u) return res.json({ err: "Không tìm thấy" })
    res.json({
        username: req.params.username,
        avatar: u.avatar || "",
        role: u.role || "member"
    })
})

// API Management routes
app.post("/create", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let { name, displayName, webhook, privateMode, viewIP, whitelistIPs } = req.body
    
    if (!name) return res.json({ err: "Thiếu tên API" })
    if (/[^\w]/.test(name)) {
        return res.json({ err: "Tên API chỉ chứa chữ, số, _" })
    }
    
    const id = utils.genID()
    db.apis[id] = {
        id,
        name,
        displayName: displayName || name,
        owner: user,
        jobs: {},
        webhook: webhook || "",
        webhookCustom: jobManager.globalDefaults.webhookCustom,
        encode: jobManager.globalDefaults.encode,
        prefix: jobManager.globalDefaults.prefix,
        suffix: jobManager.globalDefaults.suffix,
        ttl: jobManager.globalDefaults.ttl,
        removeDuplicate: jobManager.globalDefaults.removeDuplicate,
        maxJobsPerBoss: jobManager.globalDefaults.maxJobsPerBoss,
        maxTotalJobs: jobManager.globalDefaults.maxTotalJobs,
        enabled: true,
        privateMode: privateMode !== undefined ? utils.toBool(privateMode) : jobManager.globalDefaults.privateMode,
        viewIP: viewIP || "",
        whitelistIPs: whitelistIPs || [...(jobManager.globalDefaults.whitelistIPs || [])],
        jobSort: jobManager.globalDefaults.jobSort,
        customFields: jobManager.globalDefaults.customFields ? [...jobManager.globalDefaults.customFields] : null,
        apiKey: utils.genToken()
    }
    
    await db.save()
    res.json({
        ok: 1,
        id,
        apiKey: db.apis[id].apiKey,
        link: `/api/${id}/all`
    })
})

app.get("/my", (req, res) => {
    let user = auth.getUser(req)
    if (!user) return res.json([])
    
    const apis = auth.isAdminOrOwner(req) ?
        Object.values(db.apis) :
        Object.values(db.apis).filter(a => a.owner === user)
    
    res.json(apis.map(api => {
        const bossCounts = {}
        let total = 0
        for (let b in api.jobs) {
            bossCounts[b] = api.jobs[b].length
            total += api.jobs[b].length
        }
        return {
            id: api.id,
            displayName: api.displayName,
            name: api.name,
            owner: api.owner,
            totalJobs: total,
            bosses: bossCounts,
            enabled: api.enabled,
            privateMode: api.privateMode,
            ttl: api.ttl,
            webhook: !!api.webhook,
            encode: !!api.encode,
            prefix: api.prefix || "",
            suffix: api.suffix || "",
            removeDuplicate: !!api.removeDuplicate,
            jobSort: api.jobSort,
            maxJobsPerBoss: api.maxJobsPerBoss,
            maxTotalJobs: api.maxTotalJobs,
            whitelistIPs: api.whitelistIPs || [],
            customFields: api.customFields || null,
            viewIP: api.viewIP || "",
            apiKey: api.apiKey
        }
    }))
})

// Job routes
app.post("/push", async (req, res) => {
    let { id, apiKey, job, players, sea, boss } = req.body
    let api = db.apis[id]
    
    if (!api) return res.json({ err: "API không tồn tại" })
    if (!api.enabled) return res.json({ err: "API đang bị tắt" })
    if (api.apiKey !== apiKey) return res.json({ err: "Sai key" })
    if (!job) return res.json({ err: "Thiếu job" })
    if (!boss) return res.json({ err: "Thiếu boss" })
    
    boss = String(boss).toLowerCase().trim()
    let finalJob = utils.encode(job, api.encode)
    if (api.prefix) finalJob = api.prefix + finalJob
    if (api.suffix) finalJob = finalJob + api.suffix
    
    if (!api.jobs[boss]) api.jobs[boss] = []
    
    if (utils.toBool(api.removeDuplicate)) {
        let ex = api.jobs[boss].find(j => j.job === finalJob)
        if (ex) {
            ex.players = Number(players) || 0
            ex.sea = Number(sea) || 0
            ex.t = utils.now()
            jobManager.applyLimits(api)
            await db.save()
            return res.json({ ok: 1, update: true })
        }
    }
    
    let data = {
        job: finalJob,
        players: Number(players) || 0,
        sea: Number(sea) || 0,
        boss,
        t: utils.now()
    }
    api.jobs[boss].push(data)
    jobManager.applyLimits(api)
    
    if (api.webhook) {
        jobManager.sendWebhook(api.webhook, data, api.webhookCustom)
    }
    
    await db.save()
    res.json({ ok: 1 })
})

app.post("/push/bulk", async (req, res) => {
    let { id, apiKey, jobs } = req.body
    let api = db.apis[id]
    
    if (!api) return res.json({ err: "API không tồn tại" })
    if (!api.enabled) return res.json({ err: "API đang bị tắt" })
    if (api.apiKey !== apiKey) return res.json({ err: "Sai key" })
    if (!Array.isArray(jobs) || !jobs.length) {
        return res.json({ err: "Mảng jobs rỗng" })
    }
    
    let added = 0
    let dup = utils.toBool(api.removeDuplicate)
    
    for (let item of jobs) {
        let { job, players, sea, boss } = item
        if (!job || !boss) continue
        
        boss = String(boss).toLowerCase().trim()
        let finalJob = utils.encode(job, api.encode)
        if (api.prefix) finalJob = api.prefix + finalJob
        if (api.suffix) finalJob = finalJob + api.suffix
        
        if (!api.jobs[boss]) api.jobs[boss] = []
        
        if (dup) {
            let ex = api.jobs[boss].find(j => j.job === finalJob)
            if (ex) {
                ex.players = Number(players) || 0
                ex.sea = Number(sea) || 0
                ex.t = utils.now()
                added++
                continue
            }
        }
        
        api.jobs[boss].push({
            job: finalJob,
            players: Number(players) || 0,
            sea: Number(sea) || 0,
            boss,
            t: utils.now()
        })
        added++
        
        if (api.webhook) {
            jobManager.sendWebhook(api.webhook, { job: finalJob, players, sea, boss }, api.webhookCustom)
        }
    }
    
    jobManager.applyLimits(api)
    await db.save()
    res.json({ ok: 1, added })
})

app.get("/api/:id/stats", (req, res) => {
    let api = db.apis[req.params.id]
    if (!api) return res.json({ err: "API không tồn tại" })
    
    if (!auth.isAdminOrOwner(req) && api.owner !== auth.getUser(req)) {
        return res.json({ err: "Không có quyền" })
    }
    
    jobManager.cleanExpiredJobs(api)
    jobManager.applyLimits(api)
    
    const bossCounts = {}
    let total = 0
    for (let b in api.jobs) {
        bossCounts[b] = api.jobs[b].length
        total += api.jobs[b].length
    }
    
    res.json({
        id: api.id,
        displayName: api.displayName,
        totalJobs: total,
        maxJobsPerBoss: api.maxJobsPerBoss,
        maxTotalJobs: api.maxTotalJobs,
        bosses: bossCounts,
        enabled: api.enabled,
        ttl: api.ttl,
        privateMode: api.privateMode,
        removeDuplicate: !!api.removeDuplicate
    })
})

app.get("/api/:id/:boss?", (req, res) => {
    let api = db.apis[req.params.id]
    if (!api) return res.json([])
    
    if (!auth.checkApiView(req, api)) {
        return res.json({ err: "IP không được phép" })
    }
    
    jobManager.cleanExpiredJobs(api)
    jobManager.applyLimits(api)
    
    let boss = (req.params.boss || "all").toLowerCase()
    let sortOrder = (req.query.sort || api.jobSort || "desc") === "asc" ? 1 : -1
    let page = Math.max(1, parseInt(req.query.page) || 1)
    let limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50))
    let group = req.query.group === "true"
    
    if (boss === "stats") {
        return res.json({ err: "Dùng /api/:id/stats" })
    }
    
    const resp = {
        api: {
            id: api.id,
            name: api.displayName,
            owner: api.owner,
            ttl: api.ttl,
            encode: !!api.encode,
            totalJobs: 0
        },
        jobs: group ? {} : []
    }
    
    if (boss !== "all") {
        let jobs = (api.jobs[boss] || []).sort((a, b) => sortOrder * (b.t - a.t))
        resp.api.totalJobs = jobs.length
        const sliced = jobs.slice((page - 1) * limit, page * limit)
            .map(j => jobManager.filterJobFields(j, api.customFields))
        if (group) resp.jobs[boss] = sliced
        else resp.jobs = sliced
        resp.page = page
        resp.totalPages = Math.ceil(jobs.length / limit)
    } else {
        if (group) {
            let total = 0
            for (let b in api.jobs) {
                resp.jobs[b] = [...api.jobs[b]]
                    .sort((a, bb) => sortOrder * (bb.t - a.t))
                    .map(j => jobManager.filterJobFields(j, api.customFields))
                total += api.jobs[b].length
            }
            resp.api.totalJobs = total
        } else {
            let all = [], total = 0
            for (let b in api.jobs) {
                total += api.jobs[b].length
                all.push(...api.jobs[b].map(j => ({ ...j, boss: b })))
            }
            all.sort((a, b) => sortOrder * (b.t - a.t))
            resp.api.totalJobs = total
            resp.jobs = all.slice((page - 1) * limit, page * limit)
                .map(j => jobManager.filterJobFields(j, api.customFields))
            resp.page = page
            resp.totalPages = Math.ceil(total / limit)
        }
    }
    
    res.json(resp)
})

app.delete("/api/:id/job", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let api = db.apis[req.params.id]
    
    if (!api) return res.json({ err: "API không tồn tại" })
    if (!auth.isAdminOrOwner(req) && api.owner !== user) {
        return res.json({ err: "Không có quyền" })
    }
    
    let { boss, job, index } = req.body
    if (!boss) return res.json({ err: "Thiếu boss" })
    
    boss = boss.toLowerCase()
    if (!api.jobs[boss]) return res.json({ err: "Boss không có job" })
    
    if (index !== undefined) {
        let i = parseInt(index)
        if (isNaN(i) || i < 0 || i >= api.jobs[boss].length) {
            return res.json({ err: "Index không hợp lệ" })
        }
        api.jobs[boss].splice(i, 1)
        if (!api.jobs[boss].length) delete api.jobs[boss]
        await db.save()
        return res.json({ ok: 1 })
    }
    
    if (job) {
        const before = api.jobs[boss].length
        api.jobs[boss] = api.jobs[boss].filter(j => j.job !== job)
        if (!api.jobs[boss].length) delete api.jobs[boss]
        if ((api.jobs[boss]?.length ?? 0) === before) {
            return res.json({ err: "Không tìm thấy job" })
        }
        await db.save()
        return res.json({ ok: 1 })
    }
    
    res.json({ err: "Cần job hoặc index" })
})

app.delete("/api/:id/clear", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let api = db.apis[req.params.id]
    
    if (!api) return res.json({ err: "API không tồn tại" })
    if (!auth.isAdminOrOwner(req) && api.owner !== user) {
        return res.json({ err: "Không có quyền" })
    }
    
    let { boss } = req.body
    if (boss) delete api.jobs[boss.toLowerCase()]
    else api.jobs = {}
    
    await db.save()
    res.json({ ok: 1 })
})

app.delete("/api/:id", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let api = db.apis[req.params.id]
    
    if (!api) return res.json({ err: "API không tồn tại" })
    if (!auth.isAdminOrOwner(req) && api.owner !== user) {
        return res.json({ err: "Không có quyền" })
    }
    
    delete db.apis[req.params.id]
    await db.save()
    res.json({ ok: 1 })
})

app.post("/settings", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let {
        id, encodeText, ttl, webhook, displayName, privateMode, viewIP,
        removeDuplicate, prefix, suffix, maxJobsPerBoss, maxTotalJobs,
        enabled, whitelistIPs, jobSort, customFields, webhookCustom
    } = req.body
    
    let api = db.apis[id]
    if (!api) return res.json({ err: "API không tồn tại" })
    if (!auth.isAdminOrOwner(req) && api.owner !== user) {
        return res.json({ err: "Không có quyền" })
    }
    
    if (encodeText !== undefined) api.encode = utils.parseEncode(encodeText)
    if (ttl !== undefined) api.ttl = Number(ttl)
    if (webhook !== undefined) api.webhook = webhook
    if (displayName !== undefined) api.displayName = displayName
    if (privateMode !== undefined) api.privateMode = utils.toBool(privateMode)
    if (viewIP !== undefined) api.viewIP = viewIP
    if (removeDuplicate !== undefined) api.removeDuplicate = utils.toBool(removeDuplicate)
    if (prefix !== undefined) api.prefix = String(prefix)
    if (suffix !== undefined) api.suffix = String(suffix)
    if (maxJobsPerBoss !== undefined) api.maxJobsPerBoss = Number(maxJobsPerBoss)
    if (maxTotalJobs !== undefined) api.maxTotalJobs = Number(maxTotalJobs)
    if (enabled !== undefined) api.enabled = utils.toBool(enabled)
    if (whitelistIPs !== undefined) api.whitelistIPs = Array.isArray(whitelistIPs) ? whitelistIPs : []
    if (jobSort !== undefined && ["asc", "desc"].includes(jobSort)) api.jobSort = jobSort
    if (customFields !== undefined) api.customFields = Array.isArray(customFields) ? customFields : null
    if (webhookCustom !== undefined) api.webhookCustom = webhookCustom
    
    jobManager.applyLimits(api)
    await db.save()
    res.json({ ok: 1 })
})

app.put("/api/:id/rename", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let api = db.apis[req.params.id]
    
    if (!api) return res.json({ err: "API không tồn tại" })
    if (!auth.isAdminOrOwner(req) && api.owner !== user) {
        return res.json({ err: "Không có quyền" })
    }
    
    const { displayName } = req.body
    if (displayName !== undefined) {
        if (typeof displayName !== "string" || !displayName.trim()) {
            return res.json({ err: "Tên hiển thị không hợp lệ" })
        }
        api.displayName = displayName.trim()
        await db.save()
        return res.json({ ok: 1, displayName: api.displayName })
    }
    res.json({ err: "Thiếu displayName" })
})

// Admin/Owner routes
app.get("/owner", auth.requireAdminOrOwner, (req, res) => {
    res.json(db.data)
})

app.post("/owner/edit", auth.requireOwner, async (req, res) => {
    let {
        id, encodeText, ttl, webhook, displayName, privateMode, viewIP,
        removeDuplicate, prefix, suffix, maxJobsPerBoss, maxTotalJobs,
        enabled, whitelistIPs, jobSort, customFields, webhookCustom
    } = req.body
    
    let api = db.apis[id]
    if (!api) return res.json({ err: "API không tồn tại" })
    
    if (encodeText !== undefined) api.encode = utils.parseEncode(encodeText)
    if (ttl !== undefined) api.ttl = Number(ttl)
    if (webhook !== undefined) api.webhook = webhook
    if (displayName !== undefined) api.displayName = displayName
    if (privateMode !== undefined) api.privateMode = utils.toBool(privateMode)
    if (viewIP !== undefined) api.viewIP = viewIP
    if (removeDuplicate !== undefined) api.removeDuplicate = utils.toBool(removeDuplicate)
    if (prefix !== undefined) api.prefix = String(prefix)
    if (suffix !== undefined) api.suffix = String(suffix)
    if (maxJobsPerBoss !== undefined) api.maxJobsPerBoss = Number(maxJobsPerBoss)
    if (maxTotalJobs !== undefined) api.maxTotalJobs = Number(maxTotalJobs)
    if (enabled !== undefined) api.enabled = utils.toBool(enabled)
    if (whitelistIPs !== undefined) api.whitelistIPs = Array.isArray(whitelistIPs) ? whitelistIPs : []
    if (jobSort !== undefined && ["asc", "desc"].includes(jobSort)) api.jobSort = jobSort
    if (customFields !== undefined) api.customFields = Array.isArray(customFields) ? customFields : null
    if (webhookCustom !== undefined) api.webhookCustom = webhookCustom
    
    jobManager.applyLimits(api)
    await db.save()
    res.json({ ok: 1 })
})

app.get("/owner/stats", auth.requireOwner, (req, res) => {
    let totalJobs = 0
    Object.values(db.apis).forEach(api => {
        Object.values(api.jobs).forEach(arr => totalJobs += arr.length)
    })
    
    res.json({
        totalApis: Object.keys(db.apis).length,
        totalJobs,
        totalUsers: Object.keys(db.users).length,
        activeSessions: Object.keys(db.sessions).length,
        totalBots: Object.keys(db.bots).length,
        runningBots: Object.values(db.bots).filter(b => b.status === "running").length,
        totalMonitors: Object.keys(db.monitors).length,
        onlineMonitors: Object.values(db.monitors).filter(m => m.lastStatus === "online").length
    })
})

app.post("/owner/global-settings", auth.requireOwner, async (req, res) => {
    let {
        ttl, prefix, suffix, encodeText, removeDuplicate,
        maxJobsPerBoss, maxTotalJobs, enabled, privateMode,
        whitelistIPs, jobSort, customFields, webhookCustom
    } = req.body
    
    const g = jobManager.globalDefaults
    if (ttl !== undefined) g.ttl = Number(ttl)
    if (prefix !== undefined) g.prefix = String(prefix)
    if (suffix !== undefined) g.suffix = String(suffix)
    if (encodeText !== undefined) g.encode = utils.parseEncode(encodeText)
    if (removeDuplicate !== undefined) g.removeDuplicate = utils.toBool(removeDuplicate)
    if (maxJobsPerBoss !== undefined) g.maxJobsPerBoss = Number(maxJobsPerBoss)
    if (maxTotalJobs !== undefined) g.maxTotalJobs = Number(maxTotalJobs)
    if (enabled !== undefined) g.enabled = utils.toBool(enabled)
    if (privateMode !== undefined) g.privateMode = utils.toBool(privateMode)
    if (whitelistIPs !== undefined) g.whitelistIPs = Array.isArray(whitelistIPs) ? whitelistIPs : []
    if (jobSort !== undefined && ["asc", "desc"].includes(jobSort)) g.jobSort = jobSort
    if (customFields !== undefined) g.customFields = Array.isArray(customFields) ? customFields : null
    if (webhookCustom !== undefined) g.webhookCustom = webhookCustom
    
    await db.save()
    res.json({ ok: 1, globalDefaults: g })
})

app.get("/owner/global-settings", auth.requireOwner, (req, res) => {
    res.json(jobManager.globalDefaults)
})

app.post("/owner/reset-api-key", auth.requireOwner, async (req, res) => {
    let api = db.apis[req.body.id]
    if (!api) return res.json({ err: "API không tồn tại" })
    api.apiKey = utils.genToken()
    await db.save()
    res.json({ ok: 1, apiKey: api.apiKey })
})

app.post("/owner/change-owner", auth.requireOwner, async (req, res) => {
    let { id, newOwner } = req.body
    let api = db.apis[id]
    if (!api) return res.json({ err: "API không tồn tại" })
    if (!newOwner || !db.users[newOwner]) {
        return res.json({ err: "Người dùng không tồn tại" })
    }
    api.owner = newOwner
    await db.save()
    res.json({ ok: 1 })
})

app.post("/owner/clean-all-expired", auth.requireAdminOrOwner, async (req, res) => {
    Object.values(db.apis).forEach(api => {
        jobManager.cleanExpiredJobs(api)
        jobManager.applyLimits(api)
    })
    await db.save()
    res.json({ ok: 1 })
})

app.post("/owner/set-role", auth.requireOwner, async (req, res) => {
    let { user, role } = req.body
    if (!user || !role || !db.users[user]) {
        return res.json({ err: "Thiếu thông tin hoặc user không tồn tại" })
    }
    if (!["member", "admin"].includes(role)) {
        return res.json({ err: "Role không hợp lệ" })
    }
    db.users[user].role = role
    await db.save()
    res.json({ ok: 1, user, newRole: role })
})

app.get("/admin/users", auth.requireAdminOrOwner, (req, res) => {
    res.json(Object.entries(db.users).map(([username, data]) => ({
        username,
        role: data.role || "member",
        avatar: data.avatar || "",
        createdAt: data.createdAt
    })))
})

app.post("/admin/set-role", auth.requireAdminOrOwner, async (req, res) => {
    let { user, role } = req.body
    if (!user || !role || !db.users[user]) {
        return res.json({ err: "Thiếu thông tin hoặc user không tồn tại" })
    }
    if (!["member", "admin"].includes(role)) {
        return res.json({ err: "Role không hợp lệ" })
    }
    if (db.users[user].role === "owner") {
        return res.json({ err: "Không thể thay đổi role của owner" })
    }
    db.users[user].role = role
    await db.save()
    res.json({ ok: 1, user, newRole: role })
})

// Bot routes
app.post("/bot/create", auth.requireAuth, upload.single("file"), async (req, res) => {
    let user = auth.getUser(req)
    let { name, env, autoRestart } = req.body
    
    if (!name) return res.json({ err: "Thiếu tên bot" })
    
    if (!auth.isAdminOrOwner(req)) {
        const existing = Object.values(db.bots).filter(b => b.owner === user)
        if (existing.length >= config.botLimitUser) {
            return res.json({
                err: `Mỗi tài khoản chỉ được host ${config.botLimitUser} bot Discord. Xóa bot cũ trước!`
            })
        }
    }
    
    let code = ""
    if (req.file) {
        code = fs.readFileSync(req.file.path, "utf8")
        fs.unlinkSync(req.file.path)
    } else if (req.body.code) {
        code = req.body.code
    } else {
        return res.json({ err: "Cần upload file .py hoặc gửi code" })
    }
    
    let envObj = {}
    try { envObj = JSON.parse(env || "{}") } catch {}
    
    const id = utils.genID()
    db.bots[id] = {
        id,
        name,
        owner: user,
        code: Buffer.from(code).toString("base64"),
        env: envObj,
        status: "stopped",
        pid: null,
        logs: [],
        autoRestart: utils.toBool(autoRestart || false),
        restartCount: 0,
        created_at: utils.now(),
        updated_at: utils.now()
    }
    
    await db.save()
    res.json({ ok: 1, id })
})

app.get("/bot/my", (req, res) => {
    let user = auth.getUser(req)
    if (!user) return res.json([])
    
    res.json(Object.values(db.bots)
        .filter(b => b.owner === user || auth.isAdminOrOwner(req))
        .map(b => ({
            id: b.id,
            name: b.name,
            status: b.status,
            autoRestart: b.autoRestart || false,
            restartCount: b.restartCount || 0,
            envKeys: Object.keys(b.env || {}),
            created_at: b.created_at,
            updated_at: b.updated_at
        }))
    )
})

app.post("/bot/:id/start", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let bot = db.bots[req.params.id]
    
    if (!bot) return res.json({ err: "Bot không tồn tại" })
    if (bot.owner !== user && !auth.isAdminOrOwner(req)) {
        return res.json({ err: "Không có quyền" })
    }
    if (bot.status === "running") {
        return res.json({ err: "Bot đang chạy" })
    }
    
    bot.logs = []
    bot.restartCount = 0
    bot.autoRestart = utils.toBool(req.body.autoRestart !== undefined ?
        req.body.autoRestart : bot.autoRestart)
    
    botManager.spawn(bot)
    await db.save()
    res.json({ ok: 1, pid: bot.pid })
})

app.post("/bot/:id/stop", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let bot = db.bots[req.params.id]
    
    if (!bot) return res.json({ err: "Bot không tồn tại" })
    if (bot.owner !== user && !auth.isAdminOrOwner(req)) {
        return res.json({ err: "Không có quyền" })
    }
    
    const success = botManager.stop(req.params.id)
    if (success) {
        res.json({ ok: 1 })
    } else {
        res.json({ err: "Không thể dừng bot" })
    }
})

app.delete("/bot/:id", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let bot = db.bots[req.params.id]
    
    if (!bot) return res.json({ err: "Bot không tồn tại" })
    if (bot.owner !== user && !auth.isAdminOrOwner(req)) {
        return res.json({ err: "Không có quyền" })
    }
    
    const success = botManager.delete(req.params.id)
    if (success) {
        res.json({ ok: 1 })
    } else {
        res.json({ err: "Không thể xóa bot" })
    }
})

app.get("/bot/:id/logs", (req, res) => {
    let user = auth.getUser(req)
    let bot = db.bots[req.params.id]
    
    if (!bot) return res.json({ err: "Bot không tồn tại" })
    if (bot.owner !== user && !auth.isAdminOrOwner(req)) {
        return res.json({ err: "Không có quyền" })
    }
    
    res.json({
        logs: bot.logs.slice(-100),
        status: bot.status,
        restartCount: bot.restartCount || 0
    })
})

app.put("/bot/:id/rename", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let bot = db.bots[req.params.id]
    
    if (!bot) return res.json({ err: "Bot không tồn tại" })
    if (bot.owner !== user && !auth.isAdminOrOwner(req)) {
        return res.json({ err: "Không có quyền" })
    }
    
    const { name } = req.body
    if (!name || typeof name !== "string" || !name.trim()) {
        return res.json({ err: "Tên mới không hợp lệ" })
    }
    
    bot.name = name.trim()
    bot.updated_at = utils.now()
    await db.save()
    res.json({ ok: 1, name: bot.name })
})

// Monitor routes
app.post("/monitor/create", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let { name, url, interval, webhook } = req.body
    
    if (!name || !url) return res.json({ err: "Thiếu name hoặc url" })
    if (!url.startsWith("http")) {
        return res.json({ err: "URL phải bắt đầu bằng http/https" })
    }
    
    const id = utils.genID()
    db.monitors[id] = {
        id,
        name,
        url,
        owner: user,
        interval: Math.max(30000, Number(interval) || 60000),
        webhook: webhook || "",
        lastStatus: "waiting",
        lastPing: 0,
        lastCode: 0,
        lastError: null,
        lastCheck: 0,
        totalChecks: 0,
        goodChecks: 0,
        uptime: "0.00",
        retry: 0,
        history: [],
        created_at: utils.now()
    }
    
    await db.save()
    monitorManager.check(db.monitors[id])
    res.json({ ok: 1, id })
})

app.get("/monitor/my", (req, res) => {
    let user = auth.getUser(req)
    if (!user) return res.json([])
    
    res.json(Object.values(db.monitors)
        .filter(m => m.owner === user || auth.isAdminOrOwner(req))
    )
})

app.delete("/monitor/:id", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let m = db.monitors[req.params.id]
    
    if (!m) return res.json({ err: "Monitor không tồn tại" })
    if (m.owner !== user && !auth.isAdminOrOwner(req)) {
        return res.json({ err: "Không có quyền" })
    }
    
    delete db.monitors[req.params.id]
    await db.save()
    res.json({ ok: 1 })
})

app.get("/monitor/:id", (req, res) => {
    const m = db.monitors[req.params.id]
    if (!m) return res.json({ err: "Không tìm thấy" })
    res.json(m)
})

app.put("/monitor/:id/rename", auth.requireAuth, async (req, res) => {
    let user = auth.getUser(req)
    let mon = db.monitors[req.params.id]
    
    if (!mon) return res.json({ err: "Monitor không tồn tại" })
    if (mon.owner !== user && !auth.isAdminOrOwner(req)) {
        return res.json({ err: "Không có quyền" })
    }
    
    const { name } = req.body
    if (!name || typeof name !== "string" || !name.trim()) {
        return res.json({ err: "Tên mới không hợp lệ" })
    }
    
    mon.name = name.trim()
    await db.save()
    res.json({ ok: 1, name: mon.name })
})

// ============================================
// WEBSOCKET SERVER
// ============================================
const wss = new WebSocket.Server({ server: httpServer, path: "/ws" })
const chatMessages = []
const chatClients = new Map()

wss.on("connection", (ws, req) => {
    const token = new URL(req.url, `http://${req.headers.host}`).searchParams.get("token") || ""
    const session = db.sessions[token]
    
    if (!session) {
        ws.close(4001, "Unauthorized")
        return
    }
    
    const username = session.user
    const avatar = db.users[username]?.avatar || ""
    chatClients.set(ws, { username, avatar })
    
    ws.send(JSON.stringify({
        type: "history",
        messages: chatMessages.slice(-config.maxChatMessages)
    }))
    
    ws.on("message", raw => {
        let msg
        try { msg = JSON.parse(raw) } catch { return }
        
        if (msg.type === "msg" &&
            typeof msg.content === "string" &&
            msg.content.trim().length > 0 &&
            msg.content.length <= 500) {
            const chatMsg = {
                user: username,
                avatar,
                content: msg.content.trim(),
                timestamp: utils.now()
            }
            chatMessages.push(chatMsg)
            if (chatMessages.length > config.maxChatMessages) {
                chatMessages.shift()
            }
            broadcast({ type: "msg", ...chatMsg })
        }
    })
    
    ws.on("close", () => chatClients.delete(ws))
    ws.on("error", () => chatClients.delete(ws))
})

function broadcast(payload) {
    const data = JSON.stringify(payload)
    for (const [ws] of chatClients) {
        try { ws.send(data) } catch {}
    }
}

// ============================================
// BACKGROUND TASKS
// ============================================
setInterval(() => {
    // Clean expired jobs
    Object.values(db.apis).forEach(api => {
        jobManager.cleanExpiredJobs(api)
        jobManager.applyLimits(api)
    })
    
    // Check monitors
    Object.values(db.monitors).forEach(m => {
        if (utils.now() - (m.lastCheck || 0) >= (m.interval || 60000)) {
            monitorManager.check(m)
        }
    })
    
    db.save()
}, 15000)

setInterval(() => db.write(), 450000)

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
process.on("SIGTERM", async () => {
    await db.write()
    process.exit(0)
})

process.on("SIGINT", async () => {
    await db.write()
    process.exit(0)
})

process.on("uncaughtException", async (err) => {
    console.error("Uncaught exception:", err)
    await db.write()
})

// ============================================
// SPA FALLBACK
// ============================================
app.get("*", (req, res) => {
    if (!req.path.startsWith("/api") && !req.path.startsWith("/ws")) {
        res.sendFile(path.join(__dirname, "public", "index.html"))
    }
})

// ============================================
// START SERVER
// ============================================
async function start() {
    try {
        // Install discord.py if needed
        try {
            execSync("python3 -m pip install --user discord.py aiohttp", { stdio: "ignore" })
        } catch (e) {}
        
        // Create uploads directory
        if (!fs.existsSync("/tmp/bot_uploads")) {
            fs.mkdirSync("/tmp/bot_uploads", { recursive: true })
        }
        
        // Load database
        await db.load()
        
        // Start HTTP server
        httpServer.listen(config.port, () => {
            console.log(`🚀 Server running on port ${config.port}`)
            console.log(`📊 Dashboard: http://localhost:${config.port}`)
        })
    } catch (error) {
        console.error("Failed to start server:", error)
        process.exit(1)
    }
}

start()
