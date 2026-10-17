package fun.hardcoresmp.gatekeeper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import fun.hardcoresmp.gatekeeper.whitelist.BukkitServerAccess;
import fun.hardcoresmp.gatekeeper.whitelist.DiscordAccess;
import java.io.File;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

/** Le plugin dans un faux serveur Paper 26.2 (MockBukkit). */
class GatekeeperPluginTest {

    ServerMock server;
    GatekeeperPlugin plugin;

    @BeforeEach
    void setUp() {
        server = MockBukkit.mock();
        plugin = MockBukkit.load(GatekeeperPlugin.class);
    }

    @AfterEach
    void tearDown() {
        MockBukkit.unmock();
    }

    @Test
    void demarreSansDiscordTantQueLaConfigEstIncomplete() {
        assertTrue(plugin.isEnabled());
        assertFalse(plugin.config().discord().configured());
        assertSame(DiscordAccess.DISABLED, plugin.discordAccess());
        assertTrue(new File(plugin.getDataFolder(), "config.yml").exists(), "config.yml commentée copiée");
        assertTrue(new File(plugin.getDataFolder(), "gatekeeper.db").exists(), "base SQLite créée");
    }

    @Test
    void leBypassEstEnregistreDansConfigYml() {
        UUID uuid = UUID.randomUUID();
        assertTrue(plugin.toggleBypass(uuid));
        assertTrue(plugin.config().bypass().contains(uuid));
        assertTrue(plugin.getConfig().getStringList("bypass.uuids").contains(uuid.toString()));
        assertFalse(plugin.toggleBypass(uuid));
        assertFalse(plugin.config().bypass().contains(uuid));
    }

    @Test
    void leRechargementGardeLeServeurEnMarche() {
        var problems = plugin.reloadGatekeeper();
        assertTrue(problems.stream().anyMatch(p -> p.contains("discord.token")));
        assertTrue(plugin.isEnabled());
    }

    @Test
    void lesActionsDemandeesDepuisLeBotSontExecuteesSurLeThreadPrincipal() {
        // (La whitelist elle-même n'est pas simulée fidèlement par MockBukkit : on vérifie le passage
        // par le thread principal avec l'expulsion, qui l'est.)
        var player = server.addPlayer("Steve");
        BukkitServerAccess access = new BukkitServerAccess(plugin);
        CompletableFuture<Void> kick = CompletableFuture
                .supplyAsync(() -> access.kickIfOnline(player.getUniqueId(), net.kyori.adventure.text.Component.text("Au revoir")))
                .join();
        assertFalse(kick.isDone(), "rien ne se passe hors du thread principal");
        assertTrue(player.isOnline());
        server.getScheduler().performTicks(1);
        kick.join();
        assertFalse(player.isOnline());
    }

    @Test
    void unJoueurRetireEstExpulseAvecUnMessageEnFrancais() {
        var player = server.addPlayer("Steve");
        BukkitServerAccess access = new BukkitServerAccess(plugin);
        access.kickIfOnline(player.getUniqueId(), net.kyori.adventure.text.Component.text("Au revoir")).join();
        assertFalse(player.isOnline());
        assertEquals(0, server.getOnlinePlayers().size());
    }
}
