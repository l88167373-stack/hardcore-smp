package fun.hardcoresmp.gatekeeper.guard;

import fun.hardcoresmp.gatekeeper.config.GatekeeperConfig;
import fun.hardcoresmp.gatekeeper.config.Texts;
import fun.hardcoresmp.gatekeeper.guard.GuardVerifier.Verdict;
import fun.hardcoresmp.gatekeeper.publicconfig.PublicConfigService;
import fun.hardcoresmp.gatekeeper.storage.LinkStore;
import fun.hardcoresmp.gatekeeper.storage.RulesAcceptanceStore;
import fun.hardcoresmp.gatekeeper.whitelist.DiscordAccess;
import fun.hardcoresmp.gatekeeper.whitelist.DiscordAccess.LogEntry;
import io.papermc.paper.connection.PlayerConfigurationConnection;
import io.papermc.paper.connection.PlayerConnection;
import io.papermc.paper.event.connection.configuration.AsyncPlayerConnectionConfigureEvent;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.messaging.PluginMessageListener;

/**
 * Vérification HSMP Guard pendant la phase de configuration (le joueur n'est pas encore dans le monde) :
 * envoi d'un défi sur « hsmp:guard », attente de la réponse signée, vérification, puis accès ou refus.
 */
public final class GuardCheck implements Listener, PluginMessageListener {

    public static final String CHANNEL = "hsmp:guard";
    /** Le client Fabric déclare ses canaux au début de la configuration : on lui laisse un instant. */

    private final Plugin plugin;
    private final Supplier<GatekeeperConfig> config;
    private final PublicConfigService publicConfig;
    private final GuardVerifier verifier;
    private final RulesAcceptanceStore rules;
    private final LinkStore links;
    private final Supplier<DiscordAccess> discord;
    private final Texts texts;
    private final Logger log;
    private final SecureRandom random = new SecureRandom();
    private final Map<UUID, CompletableFuture<byte[]>> pending = new ConcurrentHashMap<>();

    public GuardCheck(Plugin plugin, Supplier<GatekeeperConfig> config, PublicConfigService publicConfig, GuardVerifier verifier,
                      RulesAcceptanceStore rules, LinkStore links, Supplier<DiscordAccess> discord, Texts texts, Logger log) {
        this.plugin = plugin;
        this.config = config;
        this.publicConfig = publicConfig;
        this.verifier = verifier;
        this.rules = rules;
        this.links = links;
        this.discord = discord;
        this.texts = texts;
        this.log = log;
    }

    @EventHandler
    public void onConfigure(AsyncPlayerConnectionConfigureEvent event) {
        GatekeeperConfig current = config.get();
        GatekeeperConfig.Guard guard = current.guard();
        if (!guard.active()) return;
        PlayerConfigurationConnection connection = event.getConnection();
        UUID uuid = connection.getProfile().getId();
        String name = connection.getProfile().getName() == null ? String.valueOf(uuid) : connection.getProfile().getName();
        if (uuid == null || current.bypass().contains(uuid)) return;

        // Ce thread est propre à ce joueur (événement asynchrone) : on peut attendre sa réponse ici.
        // Paper n'envoie un message qu'à un client qui a annoncé le canal : le Guard l'annonce dès le début.
        Verdict verdict = waitForChannel(connection, guard.timeout().toMillis())
                ? challengeAndVerify(connection, uuid, name, guard)
                : new Verdict.Refused("guard-missing", Map.of(), "canal hsmp:guard non annoncé (client sans HSMP Guard)");
        if (!connection.isConnected()) return;

        switch (verdict) {
            case Verdict.Accepted accepted -> {
                if (accepted.rulesVersion() > 0) rules.record(uuid, accepted.rulesVersion(), Instant.now());
                log.info("HSMP Guard OK pour " + name + " : " + accepted.summary());
            }
            case Verdict.Refused refused -> {
                connection.disconnect(texts.render(refused.messageKey(), refused.variables()));
                log.info("Connexion refusée pour " + name + " (" + uuid + ") : " + refused.logReason());
                links.audit("GUARD_DENIED", uuid, null, refused.logReason());
                discord.get().log(new LogEntry(LogEntry.Kind.DENIED, "Connexion refusée : " + name,
                        refused.logReason() + "\nUUID : `" + uuid + "`"));
            }
        }
    }

    /** Envoie le défi et vérifie la réponse (ou son absence). */
    private Verdict challengeAndVerify(PlayerConfigurationConnection connection, UUID uuid, String name, GatekeeperConfig.Guard guard) {
        byte[] nonce = new byte[32];
        random.nextBytes(nonce);
        long issuedAt = System.currentTimeMillis();
        CompletableFuture<byte[]> answer = new CompletableFuture<>();
        pending.put(uuid, answer);
        try {
            connection.sendPluginMessage(plugin, CHANNEL, challenge(nonce, issuedAt));
            byte[] response = answer.get(guard.timeout().toMillis(), TimeUnit.MILLISECONDS);
            return verifier.verify(response, new GuardVerifier.Challenge(nonce, issuedAt), System.currentTimeMillis(),
                    guard.timeout(), guard.keys(), publicConfig.current(), guard.failClosed()).get(20, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            return new Verdict.Refused("guard-missing", Map.of(), "pas de réponse au défi (client sans HSMP Guard)");
        } catch (Exception e) {
            log.log(Level.WARNING, "Vérification Guard de " + name + " impossible", e);
            return guard.failClosed()
                    ? new Verdict.Refused("verification-unavailable", Map.of(), "erreur interne : " + e.getMessage())
                    : new Verdict.Accepted(0, "erreur interne ignorée (fail-closed=false)");
        } finally {
            pending.remove(uuid);
        }
    }

    /** Message binaire du défi : [protocole][nonce 32 octets][heure d'émission, long]. */
    static byte[] challenge(byte[] nonce, long issuedAt) {
        return ByteBuffer.allocate(1 + nonce.length + Long.BYTES)
                .put((byte) GuardVerifier.PROTOCOL)
                .put(nonce)
                .putLong(issuedAt)
                .array();
    }

    /** Attend que le client annonce « hsmp:guard » ; faux s'il ne l'a pas fait à temps (client sans Guard). */
    private static boolean waitForChannel(PlayerConfigurationConnection connection, long timeoutMillis) {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (!connection.getListeningPluginChannels().contains(CHANNEL)) {
            if (System.currentTimeMillis() >= deadline || !connection.isConnected()) return false;
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return true;
    }

    @Override
    public void onPluginMessageReceived(String channel, PlayerConnection connection, byte[] message) {
        if (!CHANNEL.equals(channel) || !(connection instanceof PlayerConfigurationConnection configuration)) return;
        UUID uuid = configuration.getProfile().getId();
        CompletableFuture<byte[]> answer = uuid == null ? null : pending.get(uuid);
        if (answer != null) answer.complete(message);
    }

    @Override
    public void onPluginMessageReceived(String channel, Player player, byte[] message) {
        // Rien en jeu : le Guard ne répond que pendant la configuration.
    }
}
