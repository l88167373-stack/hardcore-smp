package fun.hardcoresmp.gatekeeper.discord;

import fun.hardcoresmp.gatekeeper.config.GatekeeperConfig;
import fun.hardcoresmp.gatekeeper.whitelist.DiscordAccess;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService.UnlinkReason;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.stream.Collectors;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.entities.Guild;
import net.dv8tion.jda.api.entities.Member;
import net.dv8tion.jda.api.entities.Role;
import net.dv8tion.jda.api.entities.UserSnowflake;
import net.dv8tion.jda.api.entities.channel.concrete.TextChannel;
import net.dv8tion.jda.api.events.guild.GuildBanEvent;
import net.dv8tion.jda.api.events.guild.GuildReadyEvent;
import net.dv8tion.jda.api.events.guild.member.GuildMemberRemoveEvent;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.events.message.MessageReceivedEvent;
import net.dv8tion.jda.api.events.session.ShutdownEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.requests.CloseCode;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.dv8tion.jda.api.utils.ChunkingFilter;
import net.dv8tion.jda.api.utils.MemberCachePolicy;

/**
 * Bot Discord dédié (différent du bot du pont chat) : whitelist par #whitelist et /whitelist,
 * commandes du staff /wl, retrait automatique des membres qui partent ou sont bannis, logs du staff.
 */
public final class DiscordBot extends ListenerAdapter implements DiscordAccess {

    /** Délai avant de traiter un départ : si c'est un bannissement, l'événement « ban » arrive entre-temps. */
    private static final long LEAVE_DELAY_SECONDS = 3;

    private final GatekeeperConfig.Discord settings;
    private final Supplier<GatekeeperConfig> config;
    private final Supplier<WhitelistService> whitelist;
    private final Runnable onGuildReady;
    private final Logger log;
    private final DiscordCommands commands;
    private volatile JDA jda;

    public DiscordBot(Supplier<GatekeeperConfig> config, Supplier<WhitelistService> whitelist, Runnable onGuildReady, Logger log) {
        this.settings = config.get().discord();
        this.config = config;
        this.whitelist = whitelist;
        this.onGuildReady = onGuildReady;
        this.log = log;
        this.commands = new DiscordCommands(config, whitelist, this::isStaff);
    }

    /** Démarre la connexion. À appeler hors du thread principal : JDA vérifie le token par le réseau. */
    public void start() {
        try {
            jda = JDABuilder.createLight(settings.token(),
                            GatewayIntent.GUILD_MEMBERS, // liste des membres : départs, réconciliation (intention privilégiée)
                            GatewayIntent.GUILD_MESSAGES, // messages de #whitelist
                            GatewayIntent.MESSAGE_CONTENT, // contenu des messages (intention privilégiée)
                            GatewayIntent.GUILD_MODERATION) // bannissements
                    .setMemberCachePolicy(MemberCachePolicy.ALL)
                    .setChunkingFilter(ChunkingFilter.include(Long.parseLong(settings.guildId())))
                    .addEventListeners(this)
                    .build();
        } catch (net.dv8tion.jda.api.exceptions.InvalidTokenException e) {
            log.severe("Bot Discord : le token est invalide. Génère-en un nouveau (portail développeur Discord → Bot → "
                    + "Reset Token), colle-le dans discord.token de config.yml, puis tape /gatekeeper reload.");
        } catch (RuntimeException e) {
            log.log(Level.SEVERE, "Le bot Discord n'a pas pu démarrer : vérifie la partie « discord » de config.yml", e);
        }
    }

    public void shutdown() {
        JDA current = jda;
        if (current == null) return;
        current.shutdown();
        try {
            if (!current.awaitShutdown(5, TimeUnit.SECONDS)) current.shutdownNow();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            current.shutdownNow();
        }
    }

    // --- Événements Discord ----------------------------------------------------

    @Override
    public void onGuildReady(GuildReadyEvent event) {
        if (!event.getGuild().getId().equals(settings.guildId())) return;
        event.getGuild().updateCommands().addCommands(DiscordCommands.definitions()).queue(
                ok -> log.info("Commandes Discord /whitelist et /wl enregistrées"),
                error -> log.log(Level.WARNING, "Impossible d'enregistrer les commandes Discord (permission « applications.commands » ?)", error));
        log.info("Bot Discord prêt sur « " + event.getGuild().getName() + " » (" + event.getGuild().getMemberCount() + " membres)");
        onGuildReady.run();
    }

    @Override
    public void onShutdown(ShutdownEvent event) {
        CloseCode code = event.getCloseCode();
        if (code == CloseCode.DISALLOWED_INTENTS) {
            log.severe("Bot Discord refusé : active « Server Members Intent » et « Message Content Intent » "
                    + "dans le portail développeur Discord (onglet Bot), puis /gatekeeper reload.");
        } else if (code == CloseCode.AUTHENTICATION_FAILED) {
            log.severe("Bot Discord refusé : le token est invalide. Génère-en un nouveau (Reset Token) et colle-le dans config.yml.");
        }
    }

    @Override
    public void onMessageReceived(MessageReceivedEvent event) {
        if (!event.isFromGuild() || event.getAuthor().isBot() || event.isWebhookMessage()) return;
        if (!event.getChannel().getId().equals(settings.whitelistChannelId())) return;
        var message = event.getMessage();
        String text = message.getContentRaw().trim();
        whitelist.get()
                .requestLink(event.getAuthor().getId(), event.getAuthor().getTimeCreated().toInstant(), text)
                .whenComplete((outcome, error) -> {
                    DiscordCommands.Reply reply = error != null
                            ? new DiscordCommands.Reply(false, config.get().discordMessage("error", java.util.Map.of()))
                            : commands.describe(outcome, text);
                    if (error != null) log.log(Level.WARNING, "Erreur pendant la whitelist de " + event.getAuthor().getName(), error);
                    message.addReaction(net.dv8tion.jda.api.entities.emoji.Emoji.fromUnicode(reply.success() ? "✅" : "❌")).queue(null, ignored -> {});
                    message.reply(reply.text()).mentionRepliedUser(false).queue(sent -> {
                        long seconds = settings.deleteMessagesAfter().toSeconds();
                        if (seconds > 0) {
                            sent.delete().queueAfter(seconds, TimeUnit.SECONDS, null, ignored -> {});
                            message.delete().queueAfter(seconds, TimeUnit.SECONDS, null, ignored -> {});
                        }
                    }, ignored -> {});
                });
    }

    @Override
    public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
        if (event.getGuild() == null || !event.getGuild().getId().equals(settings.guildId())) return;
        commands.handle(event);
    }

    @Override
    public void onGuildMemberRemove(GuildMemberRemoveEvent event) {
        if (!event.getGuild().getId().equals(settings.guildId())) return;
        String id = event.getUser().getId();
        CompletableFuture.delayedExecutor(LEAVE_DELAY_SECONDS, TimeUnit.SECONDS).execute(() ->
                whitelist.get().unlinkDiscord(id, UnlinkReason.LEFT_DISCORD, "départ du Discord"));
    }

    @Override
    public void onGuildBan(GuildBanEvent event) {
        if (!event.getGuild().getId().equals(settings.guildId())) return;
        whitelist.get().unlinkDiscord(event.getUser().getId(), UnlinkReason.BANNED_DISCORD, "bannissement Discord");
    }

    // --- DiscordAccess : ce dont la whitelist a besoin ---------------------------

    private Optional<Guild> readyGuild() {
        JDA current = jda;
        if (current == null || current.getStatus() != JDA.Status.CONNECTED) return Optional.empty();
        Guild guild = current.getGuildById(settings.guildId());
        // isLoaded() : tous les membres sont en cache, donc « absent » veut vraiment dire « parti ».
        return guild != null && guild.isLoaded() ? Optional.of(guild) : Optional.empty();
    }

    @Override
    public Presence presence(String discordId) {
        return readyGuild()
                .map(guild -> guild.getMemberById(discordId) != null ? Presence.PRESENT : Presence.ABSENT)
                .orElse(Presence.UNKNOWN);
    }

    @Override
    public Optional<Set<String>> memberIds() {
        return readyGuild().map(guild -> guild.getMembers().stream().map(Member::getId).collect(Collectors.toUnmodifiableSet()));
    }

    @Override
    public CompletableFuture<Void> giveWhitelistedRole(String discordId) {
        return withRole((guild, role) -> guild.addRoleToMember(UserSnowflake.fromId(discordId), role)
                .reason("HSMP Gatekeeper : joueur whitelisté").submit());
    }

    @Override
    public CompletableFuture<Void> removeWhitelistedRole(String discordId) {
        return withRole((guild, role) -> guild.removeRoleFromMember(UserSnowflake.fromId(discordId), role)
                .reason("HSMP Gatekeeper : retiré de la whitelist").submit());
    }

    @Override
    public void log(LogEntry entry) {
        JDA current = jda;
        if (current == null || !GatekeeperConfig.isSnowflake(settings.logsChannelId())) return;
        TextChannel channel = current.getTextChannelById(settings.logsChannelId());
        if (channel == null) return;
        int color = switch (entry.kind()) {
            case SUCCESS -> 0x3DDC84;
            case INFO -> 0xFF7A00;
            case WARNING -> 0xFFD000;
            case DENIED -> 0xE3121B;
        };
        channel.sendMessageEmbeds(new EmbedBuilder()
                .setTitle(entry.title())
                .setDescription(entry.description())
                .setColor(color)
                .setTimestamp(Instant.now())
                .setFooter("HSMP Gatekeeper")
                .build()).queue(null, error -> log.log(Level.FINE, "Log Discord non envoyé", error));
    }

    boolean isStaff(Member member) {
        return member.hasPermission(net.dv8tion.jda.api.Permission.ADMINISTRATOR)
                || member.getRoles().stream().anyMatch(role -> role.getId().equals(settings.adminRoleId()));
    }

    private CompletableFuture<Void> withRole(java.util.function.BiFunction<Guild, Role, CompletableFuture<Void>> action) {
        Optional<Guild> guild = readyGuild();
        if (guild.isEmpty() || !GatekeeperConfig.isSnowflake(settings.whitelistedRoleId())) return CompletableFuture.completedFuture(null);
        Role role = guild.get().getRoleById(settings.whitelistedRoleId());
        if (role == null) {
            log.warning("Rôle « Whitelisté » introuvable : vérifie discord.roles.whitelisted dans config.yml");
            return CompletableFuture.completedFuture(null);
        }
        return action.apply(guild.get(), role).exceptionally(error -> {
            log.log(Level.WARNING, "Rôle Discord non modifié (le rôle du bot doit être AU-DESSUS du rôle « Whitelisté »)", error);
            return null;
        });
    }
}
