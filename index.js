const Discord = require("discord.js"),
    config = require("./config"),
    client = new Discord.Client({ intents: Discord.Intents.FLAGS.GUILDS }),
    { AutoPoster } = require("topgg-autoposter"),
    fs = require("fs"),
    sql = require("better-sqlite3"),
    db = sql("./data.db")

if(config.topggToken) AutoPoster(config.topggToken, client)

let threads = new Map()
let channels = new Map()

const getThreads = (map, name) => {
    const data = db.prepare(`SELECT * FROM ${name}`).all()
    for(thread in data) {
        const t = data[thread]
        map.set(t.id, { threadID: t.id, serverID: t.server })
    }
}

const init = () => {

    // create table where thread id is primary key and server id is a property.
    db.prepare("CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, server TEXT)").run()

    // channels for auto-watch threads
    db.prepare("CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server TEXT)").run()

    getThreads(threads, "threads")
    getThreads(channels, "channels")

    // this is lazy, but should work
    // makes sure command is only registered once
    if(fs.existsSync("./.commands")) return

    client.api.applications(client.user.id).commands.post({
        data: {
            name:"auto",
            description: "automatically watch all threads made in a selected channel",
            options: [
                {
                    name: "channel",
                    description: "the channel to toggle",
                    required: true,
                    type: 7,
                    channel_types: [0, 5]
                }
            ]
        }
    })
    
    client.api.applications(client.user.id).commands.post({
        data: {
            name:"watch",
            description: "toggles auto-unarchive on this thread",
            options: [
                {
                    name: "thread",
                    description: "Thread to toggle auto-unarchive on",
                    required: true,
                    type: 7,
                    channel_types: [10, 11, 12]
                }
            ]
        }
    })

    client.api.applications(client.user.id).commands.post({
        data: {
            name:"threads",
            description: "lists all threads in your server that the bot is watching"
        }
    })

    client.api.applications(client.user.id).commands.post({
        data: {
            name:"batch",
            description: "batch add/remove threads to watch",
            options: [
                {
                    name: "action",
                    description: "what action to apply to the threads",
                    required: true,
                    type: 3,
                    choices: [
                        {
                            name: "watch",
                            value: "watch"
                        },
                        {
                            name: "un-watch",
                            value: "unwatch"
                        }
                    ]
                },
                {
                    name: "parent",
                    description: "The parent channel or category whose threads you want to apply an action to",
                    type: 7,
                    required: true,
                    channel_types: [0, 4, 5]
                },
                {
                    name: "pattern",
                    description: "specify which channels by name to apply an action to. Check website for more info",
                    type: 3
                }
            ]
        }
    })

    // write file keeping command from being registered every time bot starts
    fs.writeFileSync("./.commands","command have been added")
}

const checkIfBotCanManageThread = (sid) => {
    return client.guilds.cache.get(sid)?.me.permissions.has("MANAGE_THREADS")
}

module.exports = { db, client, threads, channels, checkIfBotCanManageThread }
const commands = new Map(fs.readdirSync("./commands").filter(f => f.endsWith(".js")).map(f => [f.split(".js")[0],require(`./commands/${f}`)]))
const { removeThread, addThread } = require("./commands/utils/threadActions")

const checkAll = require("./routines/checkAllThreads").run

client.on("interactionCreate", interaction => {
    if(!interaction.isCommand()) return
    const respond = (title,content, color = "#008000", private = false) => {
        const embed = new Discord.MessageEmbed()
            .setColor(color)
            .setTitle("Waterwave Utilities")
            .setFooter('yolocat#3772')
            .addFields({ name: title, value: content })

            /*
            if(content.length >= 1900) {
                const fieldArr = content.match(/.{1,1900}/gi)
                for(let i = 0; i < fieldArr.length; i++) {
                    // lazy but will work
                    if(!fieldArr[i]) continue;
                    if(content.includes(", ")) {
                        if(![">"," ", ","].includes(fieldArr[i][fieldArr[i].length - 1])) {
                            let l = fieldArr[i+1].indexOf(">")
                            console.log(l)
                            fieldArr[i] += fieldArr[i+1].substr(0, l + 1)
                            fieldArr[i+1] = fieldArr[i+1].substr(l + 1)
                        }
                    }
                    embed.addFields({ name: `(#${i+1}) ${title}`, value: fieldArr[i] })
                }
            } else {
                embed.addFields({ name: title, value: content })
            } */
            
            /*
                TODO: fix above!! its absolutely horrible
            */

        if(interaction.deferred) interaction.editReply({ embeds: [embed] })
        else interaction.reply({ embeds: [embed], ephemeral: private })
    }


    if(["auto", "batch", "watch"].includes(interaction.commandName)) {
        if(!checkIfBotCanManageThread(interaction.guildId)) return respond("??? Issue", "Bot requires manage threads permission to function!", "#ff0000")
        else if(!interaction.memberPermissions.has(Discord.Permissions.FLAGS.MANAGE_THREADS)) return respond(`You do not have permission to use /${interaction.commandName} command.`, 'You need Manage Threads permission to use it.', '#ff0000', true);
    } 
    if(!commands.has(interaction.commandName)) return respond("??? Issue", "Bot does not have that command registered. Please open a ticket.", "#ff0000", true)
    
    const cmd = commands.get(interaction.commandName)
    try {
        cmd.run(client, interaction, respond)
    } catch(err) {
        console.warn(err)
        respond("??? Internal error", "Something went wrong that probably wasnt your fault. Please open a ticket.", "#ff0000", true)
    }
})

client.on("ready", () => {
    init()
    checkAll(threads)
    console.log(`Bot running on ${client.guilds.cache.size} guilds and keeping ${threads.size} threads active.`)

    // set status every hour as it seems to go away after a while
    client.user.setPresence({ activities: [{ name: 'Waterwave Client', type: "PLAYING" }], status: 'online' });
    setInterval(() => { client.user.setPresence({ activities: [{ name: 'Waterwave Client', type: "PLAYING" }], status: 'online' }); }, 1000 * 60 * 60)
})

client.on("threadUpdate", (oldThread, newThread) => {
    if(!threads.has(newThread.id)) return
    const diff = ( ( newThread.archivedAt - oldThread.archivedAt ) / 1000 ) / 60
    if(diff > 2 && (diff + 10) < oldThread.autoArchiveDuration) {
        return removeThread(newThread.id)
    }
    if((newThread.archived) && checkIfBotCanManageThread(newThread.guildId)) newThread.setArchived(false, "automatic")
})

client.on("threadDelete", (thread) => {
    removeThread(thread.id)
})

client.on("threadCreate", (thread) => {
    if(channels.has(thread.parentId)) addThread(thread.id, thread.guildId, "threads")
})

client.login(config.token)


if(config.stats.enabled) {
    const http = require("http")
    const reqListener = (req,res) => {
        if(!req.url || !req.url.endsWith("/stats")) {
            res.writeHead(404)
            return res.end("the only path is /stats... how did you manage to mess that up?")
        }
        res.writeHead(200)
        res.end(JSON.stringify({
            guilds: client.guilds.cache.size,
            threads: threads.size
        }))
    }
    
    const server = http.createServer(reqListener)
    server.listen(config.stats.port)
}