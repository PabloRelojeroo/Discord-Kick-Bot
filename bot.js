const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } = require('discord.js');
const express = require('express');
const axios = require('axios');

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
        checkInterval: 90000 
    },
    port: process.env.PORT || 3000
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

let streamState = {
    isLive: false,
    lastNotification: null
};

const app = express();

app.get('/', (req, res) => {
    res.json({
        status: 'Bot activo',
        uptime: process.uptime(),
        streamStatus: streamState.isLive ? 'En vivo' : 'Desconectado'
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

async function getKickStreamInfo(username) {
    try {
        // Intentar primero con la API v2
        let response;
        try {
            response = await axios.get(`https://kick.com/api/v2/channels/${username}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Referer': 'https://kick.com/',
                    'Origin': 'https://kick.com'
                },
                timeout: 15000
            });
        } catch (apiError) {
            console.log('API v2 falló, intentando con v1...');
            response = await axios.get(`https://kick.com/api/v1/channels/${username}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Referer': 'https://kick.com/',
                    'Origin': 'https://kick.com'
                },
                timeout: 15000
            });
        }

        const data = response.data;
        
        if (!data) {
            console.log('No se recibieron datos del canal');
            return null;
        }

        // Verificar estructura de datos (puede variar entre v1 y v2)
        const stream = data.livestream || data;
        
        if (!stream) {
            console.log('No hay información de livestream');
            return null;
        }

        const isLive = stream.is_live || false;
        
        return {
            isLive: isLive,
            title: stream.session_title || stream.title || 'Sin título',
            game: stream.categories?.[0]?.name || stream.category?.name || 'Sin categoría',
            viewers: stream.viewer_count || 0,
            thumbnail: stream.thumbnail || null,
            streamUrl: `https://kick.com/${username}`
        };
    } catch (error) {
        console.error('Error obteniendo info del stream:', error.response?.status || error.message);
        if (error.response?.status === 403) {
            console.log('Acceso bloqueado por Kick - intentando de nuevo en el próximo ciclo');
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
        const streamInfo = await getKickStreamInfo(config.kick.username);
        
        if (!streamInfo) {
            console.log('No se pudo obtener informacion del stream - reintentando en el proximo ciclo');
            return;
        }

        console.log(`Estado del stream: ${streamInfo.isLive ? 'EN VIVO' : 'OFFLINE'} - Viewers: ${streamInfo.viewers}`);

        if (streamInfo.isLive && !streamState.isLive) {
            console.log(`🔴 ${config.kick.username} se conecto!`);
            streamState.isLive = true;
            streamState.lastNotification = Date.now();
            await sendStreamNotification(streamInfo);
        }
        else if (!streamInfo.isLive && streamState.isLive) {
            console.log(`⚫ ${config.kick.username} se desconecto`);
            streamState.isLive = false;
        }
    } catch (error) {
        console.error('Error en monitorStream:', error.message);
    }
}

// Comandos slash
const commands = [
    new SlashCommandBuilder()
        .setName('test-stream')
        .setDescription('Testea el embed de notificación de stream'),
    
    new SlashCommandBuilder()
        .setName('stream-status')
        .setDescription('Verifica el estado actual del stream')
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
    setInterval(monitorStream, config.kick.checkInterval);
    
    setTimeout(monitorStream, 5000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'test-stream') {
        // Crear un embed de prueba
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

        await interaction.reply({
            embeds: [statusEmbed],
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

        app.listen(config.port, () => {
            console.log(`Servidor HTTP ejecutándose en puerto ${config.port}`);
        });

        await client.login(config.discord.token);
    } catch (error) {
        console.error('❌ Error iniciando el bot:', error.message);
        process.exit(1);
    }
}

start();