package fun.hardcoresmp.gatekeeper.discord;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import fun.hardcoresmp.gatekeeper.config.GatekeeperConfig;
import fun.hardcoresmp.gatekeeper.storage.Link;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService.LinkOutcome;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

class DiscordCommandsTest {

    final GatekeeperConfig config = GatekeeperConfig.from(YamlConfiguration.loadConfiguration(new InputStreamReader(
            getClass().getClassLoader().getResourceAsStream("config.yml"), StandardCharsets.UTF_8)));
    final DiscordCommands commands = new DiscordCommands(() -> config, () -> null, member -> false);
    final Link steve = new Link(UUID.randomUUID(), "1", "Steve", Instant.EPOCH, Link.SELF);

    @Test
    void chaqueResultatALaBonneReponse() {
        assertTrue(commands.describe(new LinkOutcome.Linked(steve), "Steve").success());
        assertTrue(commands.describe(new LinkOutcome.Linked(steve), "Steve").text().contains("**Steve**"));
        var tooYoung = commands.describe(new LinkOutcome.AccountTooYoung(7), "x");
        assertFalse(tooYoung.success());
        assertTrue(tooYoung.text().startsWith("❌"));
        assertTrue(commands.describe(new LinkOutcome.TakenByOther(steve), "Steve").text().contains("autre membre"));
        assertTrue(commands.describe(new LinkOutcome.LookupFailed(), "Steve").text().contains("Mojang"));
    }

    @Test
    void unPseudoSaisiNePeutPasMentionnerNiMettreEnForme() {
        assertEquals("everyone", DiscordCommands.sanitize("@everyone"));
        assertEquals("gras", DiscordCommands.sanitize("**gras**"));
        assertTrue(DiscordCommands.sanitize("a".repeat(100)).length() <= 33);
        var reply = commands.describe(new LinkOutcome.NameNotFound("@here"), "@here");
        assertFalse(reply.text().contains("@here"));
    }

    @Test
    void lesCommandesSlashSontDeclarees() {
        var names = DiscordCommands.definitions().stream().map(c -> c.getName()).toList();
        assertEquals(java.util.List.of("whitelist", "wl"), names);
    }
}
