package fun.hardcoresmp.gatekeeper;

import fun.hardcoresmp.gatekeeper.command.GatekeeperCommand;
import fun.hardcoresmp.gatekeeper.config.GatekeeperConfig;
import fun.hardcoresmp.gatekeeper.config.Texts;
import fun.hardcoresmp.gatekeeper.discord.DiscordBot;
import fun.hardcoresmp.gatekeeper.guard.CachedModrinthResolver;
import fun.hardcoresmp.gatekeeper.guard.GuardCheck;
import fun.hardcoresmp.gatekeeper.guard.GuardVerifier;
import fun.hardcoresmp.gatekeeper.guard.ModrinthResolver;
import fun.hardcoresmp.gatekeeper.login.LoginGate;
import fun.hardcoresmp.gatekeeper.mojang.MojangProfileLookup;
import fun.hardcoresmp.gatekeeper.mojang.ProfileLookup;
import fun.hardcoresmp.gatekeeper.publicconfig.PublicConfigService;
import fun.hardcoresmp.gatekeeper.storage.Database;
import fun.hardcoresmp.gatekeeper.storage.LinkStore;
import fun.hardcoresmp.gatekeeper.storage.RulesAcceptanceStore;
import fun.hardcoresmp.gatekeeper.whitelist.BukkitServerAccess;
import fun.hardcoresmp.gatekeeper.whitelist.DiscordAccess;
import fun.hardcoresmp.gatekeeper.whitelist.ServerAccess;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.sql.SQLException;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.logging.Level;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

/**
 * HSMP Gatekeeper : whitelist via Discord, contrôle à la connexion (et HSMP Guard en phase 5).
 * Ne modifie aucun autre plugin du serveur et n'utilise que ses propres commandes et fichiers.
 * (Classe non « final » : MockBukkit doit pouvoir l'étendre pour les tests.)
 */
public class GatekeeperPlugin extends JavaPlugin {

    private volatile GatekeeperConfig config;
    private volatile DiscordAccess discordAccess = DiscordAccess.DISABLED;
    private DiscordBot bot;
    private Database database;
    private WhitelistService whitelist;
    private BukkitTask reconcileTask;
    private BukkitTask publicConfigTask;
    private PublicConfigService publicConfig;

    /** Permet aux tests de remplacer l'accès à Mojang et au serveur. */
    ProfileLookup profileLookup;
    ServerAccess serverAccess;
    ModrinthResolver modrinthResolver;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        config = readConfig();

        try {
            database = new Database(getDataFolder().toPath().resolve("gatekeeper.db"));
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "Base de données inaccessible : le Gatekeeper est désactivé", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        LinkStore links = new LinkStore(database);
        links.load();

        Texts texts = new Texts(() -> config);
        if (profileLookup == null) profileLookup = new MojangProfileLookup("HSMPGatekeeper/" + getPluginMeta().getVersion());
        if (serverAccess == null) serverAccess = new BukkitServerAccess(this);
        whitelist = new WhitelistService(links, profileLookup, serverAccess, () -> discordAccess, () -> config,
                texts, Clock.systemUTC(), getLogger());

        getServer().getPluginManager().registerEvents(new LoginGate(() -> whitelist, () -> discordAccess, texts, getLogger()), this);

        // HSMP Guard : défi pendant la phase de configuration, puis vérification (signature, règlement, mods).
        publicConfig = new PublicConfigService(getDataFolder().toPath().resolve("public-config-cache"),
                () -> config.publicConfig().online() ? config.publicConfig().url() : null, getLogger());
        if (modrinthResolver == null) {
            modrinthResolver = new CachedModrinthResolver(database, "HSMPGatekeeper/" + getPluginMeta().getVersion() + " (hardcore-smp.mine.fun)");
        }
        GuardCheck guardCheck = new GuardCheck(this, () -> config, publicConfig, new GuardVerifier(modrinthResolver),
                new RulesAcceptanceStore(database), links, () -> discordAccess, texts, getLogger());
        getServer().getPluginManager().registerEvents(guardCheck, this);
        getServer().getMessenger().registerOutgoingPluginChannel(this, GuardCheck.CHANNEL);
        getServer().getMessenger().registerIncomingPluginChannel(this, GuardCheck.CHANNEL, guardCheck);
        schedulePublicConfigRefresh();
        getLifecycleManager().registerEventHandler(LifecycleEvents.COMMANDS, event -> event.registrar()
                .register("gatekeeper", "HSMP Gatekeeper : recharger, infos joueur, bypass", List.of("gk"), new GatekeeperCommand(this)));

        // Le bot se connecte en arrière-plan : le démarrage du serveur n'attend jamais Discord.
        getServer().getScheduler().runTaskAsynchronously(this, this::startBot);
        scheduleReconcile();
        getLogger().info("HSMP Gatekeeper prêt : " + links.size() + " joueur(s) whitelisté(s)"
                + (config.discord().configured() ? ", connexion du bot Discord en cours" : ", bot Discord désactivé (config.yml incomplète)")
                + (config.guard().active() ? ", vérification HSMP Guard active" : ", vérification HSMP Guard DÉSACTIVÉE")
                + ", configuration publique : " + publicConfig.source());
    }

    @Override
    public void onDisable() {
        if (reconcileTask != null) reconcileTask.cancel();
        if (publicConfigTask != null) publicConfigTask.cancel();
        stopBot();
        if (database != null) database.close();
    }

    public GatekeeperConfig config() {
        return config;
    }

    public WhitelistService whitelist() {
        return whitelist;
    }

    public DiscordAccess discordAccess() {
        return discordAccess;
    }

    /** /gatekeeper reload : relit config.yml et reconnecte le bot. Renvoie les problèmes détectés. */
    public List<String> reloadGatekeeper() {
        reloadConfig();
        config = readConfig();
        // Reconnexion du bot hors du thread principal (l'arrêt peut prendre quelques secondes).
        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            stopBot();
            startBot();
        });
        scheduleReconcile();
        schedulePublicConfigRefresh();
        return config.problems();
    }

    /** Active ou retire le bypass d'un joueur (enregistré dans config.yml). Renvoie le nouvel état. */
    public boolean toggleBypass(UUID uuid) {
        List<String> list = new ArrayList<>(getConfig().getStringList("bypass.uuids"));
        boolean enabled = !list.removeIf(entry -> entry.trim().equalsIgnoreCase(uuid.toString()));
        if (enabled) list.add(uuid.toString());
        getConfig().set("bypass.uuids", list);
        saveConfig();
        config = readConfig();
        return enabled;
    }

    private GatekeeperConfig readConfig() {
        GatekeeperConfig read = GatekeeperConfig.from(getConfig());
        for (String problem : read.problems()) getLogger().warning("config.yml : " + problem);
        return read;
    }

    private synchronized void startBot() {
        if (!config.discord().configured()) {
            discordAccess = DiscordAccess.DISABLED;
            return;
        }
        bot = new DiscordBot(() -> config, () -> whitelist, this::reconcileNow, getLogger());
        discordAccess = bot;
        bot.start();
    }

    private synchronized void stopBot() {
        DiscordBot current = bot;
        bot = null;
        discordAccess = DiscordAccess.DISABLED;
        if (current != null) current.shutdown();
    }

    private void scheduleReconcile() {
        if (reconcileTask != null) reconcileTask.cancel();
        long period = config.discord().reconcileInterval().toSeconds() * 20L;
        reconcileTask = getServer().getScheduler().runTaskTimerAsynchronously(this, this::reconcileNow, period, period);
    }

    private void schedulePublicConfigRefresh() {
        if (publicConfigTask != null) publicConfigTask.cancel();
        long period = config.publicConfig().refreshInterval().toSeconds() * 20L;
        publicConfigTask = getServer().getScheduler().runTaskTimerAsynchronously(this, publicConfig::refresh, 1L, period);
    }

    public PublicConfigService publicConfig() {
        return publicConfig;
    }

    private void reconcileNow() {
        whitelist.reconcile().exceptionally(error -> {
            getLogger().log(Level.WARNING, "Réconciliation impossible", error);
            return 0;
        });
    }
}
