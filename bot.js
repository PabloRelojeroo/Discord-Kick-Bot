const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } = require('discord.js');
const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Configuración
const config = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.DISCORD_CLIENT_ID,
        guildId: process.env.DISCORD_GUILD_ID,
        channelId: process.env.DISCORD_CHANNEL_ID 
    },
    kick: {
        username: 'selkie777',
        checkInterval: 120000, 
        retryDelay: 30000, 
        maxRetries: 3
    },
    port: process.env.PORT || 3000
};

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0'
];

const proxyList = [
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

let streamState = {
    isLive: false,
    lastNotification: null,
    failedAttempts: 0,
    lastSuccessfulCheck: null
};

function getRandomUserAgent() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getRandomProxy() {
    if (proxyList.length === 0) return null;
    return proxyList[Math.floor(Math.random() * proxyList.length)];
}

function generateHeaders() {
    const userAgent = getRandomUserAgent();
    return {
        'User-Agent': userAgent,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://kick.com/',
        'Origin': 'https://kick.com',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const app = express();

app.get('/', (req, res) => {
    res.json({
        status: 'Bot activo',
        uptime: process.uptime(),
        streamStatus: streamState.isLive ? 'En vivo' : 'Desconectado',
        failedAttempts: streamState.failedAttempts,
        lastSuccessfulCheck: streamState.lastSuccessfulCheck
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

async function getKickStreamInfo(username, retryCount = 0) {
    try {
        const headers = generateHeaders();
        const proxy = getRandomProxy();
        
        const axiosConfig = {
            headers: headers,
            timeout: 20000,
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 300;
            }
        };

        if (proxy) {
            axiosConfig.httpsAgent = new HttpsProxyAgent(proxy);
            axiosConfig.httpAgent = new HttpsProxyAgent(proxy);
        }
        // Pausa aleatoria para parecer más humano
        await sleep(Math.random() * 2000 + 1000);

        let response;
        let apiUsed = '';

        const endpoints = [
            `https://kick.com/api/v2/channels/${username}`,
            `https://kick.com/api/v1/channels/${username}`,
            `https://kick.com/api/channels/${username}`
        ];

        for (let i = 0; i < endpoints.length; i++) {
            try {
                console.log(`Intentando endpoint ${i + 1}/${endpoints.length}: ${endpoints[i]}`);
                response = await axios.get(endpoints[i], axiosConfig);
                apiUsed = endpoints[i];
                break;
            } catch (endpointError) {
                console.log(`Endpoint ${i + 1} falló:`, endpointError.response?.status || endpointError.message);
                if (i === endpoints.length - 1) {
                    throw endpointError;
                }
                await sleep(2000); 
            }
        }

        const data = response.data;
        
        if (!data) {
            console.log('No se recibieron datos del canal');
            return null;
        }

        const stream = data.livestream || data.live_stream || data;
        
        if (!stream) {
            console.log('No hay información de livestream en la respuesta');
            return null;
        }

        const isLive = stream.is_live || stream.live || false;
        
        streamState.failedAttempts = 0;
        streamState.lastSuccessfulCheck = new Date().toISOString();
        
        console.log(`Datos obtenidos exitosamente desde: ${apiUsed}`);
        
        return {
            isLive: isLive,
            title: stream.session_title || stream.title || 'Sin título',
            game: stream.categories?.[0]?.name || stream.category?.name || 'Sin categoría',
            viewers: stream.viewer_count || stream.viewers || 0,
            thumbnail: stream.thumbnail || null,
            streamUrl: `https://kick.com/${username}`,
            apiUsed: apiUsed
        };

    } catch (error) {
        streamState.failedAttempts++;
        console.error(`Error obteniendo info del stream (intento ${retryCount + 1}):`, error.response?.status || error.message);
        
        // Manejar diferentes tipos de errores
        if (error.response) {
            const status = error.response.status;
            switch (status) {
                case 403:
                    console.log('Acceso bloqueado (403) - Esperando más tiempo antes del próximo intento');
                    break;
                case 429:
                    console.log('Rate limit alcanzado (429) - Pausando requests');
                    break;
                case 404:
                    console.log('Canal no encontrado (404) - Verificar nombre de usuario');
                    break;
                case 502:
                case 503:
                case 504:
                    console.log(`Error del servidor (${status}) - Problema temporal de Kick`);
                    break;
                default:
                    console.log(`Error HTTP ${status}`);
            }
        }

        if (retryCount < config.kick.maxRetries) {
            const waitTime = config.kick.retryDelay * (retryCount + 1);
            console.log(`Reintentando en ${waitTime/1000} segundos...`);
            await sleep(waitTime);
            return getKickStreamInfo(username, retryCount + 1);
        }

        return null;
    }
}

function createStreamEmbed(streamInfo) {
    const embed = new EmbedBuilder()
        .setTitle(`🔴 ${streamInfo.title}`)
        .setDescription(`**${config.kick.username}** ESTA ON !!`)
        .addFields(
            { name: 'Juego', value: streamInfo.game, inline: true },
            { name: 'Viewers', value: streamInfo.viewers.toString(), inline: true },
            { name: 'Plataforma', value: 'Kick', inline: true }
        )
        .setColor(0x53FC18)
        .setFooter({ text: 'Kick Stream Notification' })
        .setTimestamp();

    if (streamInfo.thumbnail) {
        embed.setImage(streamInfo.thumbnail);
    }

    return embed;
}

function createStreamButton(streamUrl) {
    const button = new ButtonBuilder()
        .setLabel('Ver Stream')
        .setStyle(ButtonStyle.Link)
        .setURL(streamUrl);

    return new ActionRowBuilder().addComponents(button);
}

async function sendStreamNotification(streamInfo) {
    try {
        const channel = client.channels.cache.get(config.discord.channelId);
        if (!channel) {
            console.error('Canal no encontrado');
            return;
        }

        const embed = createStreamEmbed(streamInfo);
        const button = createStreamButton(streamInfo.streamUrl);

        await channel.send({
            content: `🚨 **${config.kick.username}** acaba de arrancar stream !!`,
            embeds: [embed],
            components: [button]
        });

        console.log('Notificación de stream enviada');
    } catch (error) {
        console.error('Error enviando notificación:', error);
    }
}

async function monitorStream() {
    try {
        console.log(`Verificando estado del stream de ${config.kick.username}...`);
        
        const streamInfo = await getKickStreamInfo(config.kick.username);
        
        if (!streamInfo) {
            console.log(`No se pudo obtener información del stream (fallos: ${streamState.failedAttempts})`);
            
            if (streamState.failedAttempts >= 5) {
                console.log('Demasiados fallos - Aumentando intervalo de verificación temporalmente');
            }
            return;
        }

        console.log(`Estado: ${streamInfo.isLive ? '🔴 EN VIVO' : '⚫ OFFLINE'} - Viewers: ${streamInfo.viewers} - API: ${streamInfo.apiUsed}`);

        if (streamInfo.isLive && !streamState.isLive) {
            console.log(`${config.kick.username} se conectó!`);
            streamState.isLive = true;
            streamState.lastNotification = Date.now();
            await sendStreamNotification(streamInfo);
        }
        else if (!streamInfo.isLive && streamState.isLive) {
            console.log(`${config.kick.username} se desconectó`);
            streamState.isLive = false;
        }

    } catch (error) {
        console.error('Error en monitorStream:', error.message);
        streamState.failedAttempts++;
    }
}

// Comandos slash
const commands = [
    new SlashCommandBuilder()
        .setName('test-stream')
        .setDescription('Testea el embed de notificación de stream'),
    
    new SlashCommandBuilder()
        .setName('stream-status')
        .setDescription('Verifica el estado actual del stream'),
    
    new SlashCommandBuilder()
        .setName('bot-stats')
        .setDescription('Muestra estadísticas del bot')
];

async function registerCommands() {
    try {
        if (!config.discord.clientId) {
            console.log('CLIENT_ID no configurado, saltando registro de comandos');
            return;
        }

        const rest = new REST({ version: '10' }).setToken(config.discord.token);
        
        console.log('Registrando comandos slash...');
        
        if (config.discord.guildId) {
            await rest.put(
                Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
                { body: commands }
            );
            console.log('Comandos de guild registrados exitosamente');
        } else {
            await rest.put(
                Routes.applicationCommands(config.discord.clientId),
                { body: commands }
            );
            console.log('Comandos globales registrados exitosamente');
        }
    } catch (error) {
        console.error('Error registrando comandos:', error);
        console.log('El bot funcionará sin comandos slash. Verifica tu DISCORD_CLIENT_ID');
    }
}

client.once('ready', async () => {
    console.log(`Bot conectado como ${client.user.tag}`);
    
    await registerCommands();
    
    console.log(`Monitoreando stream de ${config.kick.username}...`);
    console.log(`Intervalo de verificación: ${config.kick.checkInterval/1000} segundos`);
    
    // Iniciar monitoreo
    setInterval(monitorStream, config.kick.checkInterval);
    
    // Primera verificación después de 5 segundos
    setTimeout(monitorStream, 5000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'test-stream') {
        const testStreamInfo = {
            title: 'Stream de prueba - funcando',
            game: 'Juego de test',
            viewers: 42,
            thumbnail: 'https://via.placeholder.com/400x225/53FC18/FFFFFF?text=KICK+STREAM',
            streamUrl: `https://kick.com/${config.kick.username}`
        };

        const embed = createStreamEmbed(testStreamInfo);
        const button = createStreamButton(testStreamInfo.streamUrl);

        await interaction.reply({
            content: '**Embed de prueba**',
            embeds: [embed],
            components: [button],
            ephemeral: true
        });
    }
    
    else if (commandName === 'stream-status') {
        const streamInfo = await getKickStreamInfo(config.kick.username);
        
        if (!streamInfo) {
            await interaction.reply({
                content: 'No se pudo verificar el estado del stream',
                ephemeral: true
            });
            return;
        }

        const statusEmbed = new EmbedBuilder()
            .setTitle(`Estado de ${config.kick.username}`)
            .setDescription(streamInfo.isLive ? '🔴 **ON**' : '⚫ **DESCONECTADO**')
            .setColor(streamInfo.isLive ? 0x53FC18 : 0x808080)
            .setTimestamp();

        if (streamInfo.isLive) {
            statusEmbed.addFields(
                { name: 'Título', value: streamInfo.title, inline: false },
                { name: 'Juego', value: streamInfo.game, inline: true },
                { name: 'Viewers', value: streamInfo.viewers.toString(), inline: true }
            );
        }

        statusEmbed.addFields(
            { name: 'API Usada', value: streamInfo.apiUsed || 'N/A', inline: true }
        );

        await interaction.reply({
            embeds: [statusEmbed],
            ephemeral: true
        });
    }
    
    else if (commandName === 'bot-stats') {
        const statsEmbed = new EmbedBuilder()
            .setTitle('Estadísticas del Bot')
            .addFields(
                { name: 'Uptime', value: `${Math.floor(process.uptime() / 60)} minutos`, inline: true },
                { name: 'Intentos Fallidos', value: streamState.failedAttempts.toString(), inline: true },
                { name: 'Última Verificación Exitosa', value: streamState.lastSuccessfulCheck || 'Nunca', inline: false },
                { name: 'Estado Actual', value: streamState.isLive ? '🔴 En Vivo' : '⚫ Offline', inline: true },
                { name: 'Intervalo de Verificación', value: `${config.kick.checkInterval/1000}s`, inline: true }
            )
            .setColor(0x00AE86)
            .setTimestamp();

        await interaction.reply({
            embeds: [statsEmbed],
            ephemeral: true
        });
    }
});

client.on('error', error => {
    console.error('Error del cliente Discord:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

async function start() {
    try {
        if (!config.discord.token) {
            throw new Error('DISCORD_TOKEN no está configurado');
        }
        if (!config.discord.channelId) {
            throw new Error('DISCORD_CHANNEL_ID no está configurado');
        }

        console.log('Iniciando bot...');
        console.log(`Monitoreando: ${config.kick.username}`);
        console.log(`Canal notificaciones: ${config.discord.channelId}`);
        console.log(`Client ID: ${config.discord.clientId ? 'Configurado' : 'No configurado (comandos deshabilitados)'}`);
        console.log(`User-Agents disponibles: ${userAgents.length}`);
        console.log(`Proxies configurados: ${proxyList.length}`);

        app.listen(config.port, () => {
            console.log(`Servidor HTTP ejecutándose en puerto ${config.port}`);
        });

        await client.login(config.discord.token);
    } catch (error) {
        console.error('Error iniciando el bot:', error.message);
        process.exit(1);
    }
}

start();