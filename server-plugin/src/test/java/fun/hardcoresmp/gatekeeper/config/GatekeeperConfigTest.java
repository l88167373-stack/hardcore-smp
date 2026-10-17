package fun.hardcoresmp.gatekeeper.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

class GatekeeperConfigTest {

    static YamlConfiguration bundled() {
        var stream = GatekeeperConfigTest.class.getClassLoader().getResourceAsStream("config.yml");
        return YamlConfiguration.loadConfiguration(new InputStreamReader(stream, StandardCharsets.UTF_8));
    }

    @Test
    void laConfigParDefautDemarreSansBotEtListeCeQuiManque() {
        GatekeeperConfig config = GatekeeperConfig.from(bundled());
        assertFalse(config.discord().configured(), "le bot ne démarre pas tant qu'il reste des TODO");
        assertTrue(config.problems().stream().anyMatch(p -> p.contains("discord.token")));
        assertTrue(config.problems().stream().anyMatch(p -> p.contains("guild-id")));
        assertEquals(7, config.discord().minAccountAgeDays());
        assertEquals(6, config.discord().reconcileInterval().toHours());
        assertEquals(GatekeeperConfig.OfflinePolicy.ALLOW, config.discord().offlinePolicy());
        assertTrue(config.syncVanillaWhitelist());
    }

    @Test
    void uneConfigCompleteActiveLeBot() {
        YamlConfiguration yaml = bundled();
        yaml.set("discord.token", "un-vrai-token");
        yaml.set("discord.guild-id", "123456789012345678");
        yaml.set("discord.channels.whitelist", "123456789012345679");
        yaml.set("discord.channels.logs", "123456789012345680");
        yaml.set("discord.roles.whitelisted", "123456789012345681");
        yaml.set("discord.roles.admin", "123456789012345682");
        yaml.set("discord.offline-policy", "deny");
        yaml.set("guard.keys", List.of(java.util.Base64.getEncoder().encodeToString(new byte[32])));
        GatekeeperConfig config = GatekeeperConfig.from(yaml);
        assertTrue(config.discord().configured());
        assertTrue(config.guard().active());
        assertEquals(List.of(), config.problems());
        assertEquals(GatekeeperConfig.OfflinePolicy.DENY, config.discord().offlinePolicy());
    }

    @Test
    void lesErreursDeSaisieSontSignaleesSansFairePlanterLeServeur() {
        YamlConfiguration yaml = bundled();
        yaml.set("discord.guild-id", "pas-un-id");
        yaml.set("bypass.uuids", List.of("069a79f4-44e9-4726-a5be-fca90e38aaf5", "n'importe quoi"));
        GatekeeperConfig config = GatekeeperConfig.from(yaml);
        assertTrue(config.problems().stream().anyMatch(p -> p.contains("pas-un-id")));
        assertTrue(config.problems().stream().anyMatch(p -> p.contains("n'importe quoi")));
        assertEquals(1, config.bypass().size());
    }

    @Test
    void lesMessagesEnJeuSontEnFrancaisEtSansInjection() {
        YamlConfiguration yaml = bundled();
        yaml.set("links.discord-invite", "https://discord.gg/abc");
        GatekeeperConfig config = GatekeeperConfig.from(yaml);
        Texts texts = new Texts(() -> config);
        String plain = PlainTextComponentSerializer.plainText().serialize(texts.render("not-whitelisted", "<red>pirate</red>"));
        assertTrue(plain.contains("Tu n'es pas whitelisté."));
        assertTrue(plain.contains("https://discord.gg/abc"));
        assertTrue(plain.contains("#whitelist"));
    }

    @Test
    void lesReponsesDiscordRemplacentLesVariables() {
        GatekeeperConfig config = GatekeeperConfig.from(bundled());
        assertEquals("✅ Bienvenue **Steve** ! Tu es whitelisté. Lance le launcher officiel HARDCORE SMP pour jouer.",
                config.discordMessage("linked", Map.of("name", "Steve")));
        assertTrue(config.discordMessage("account-too-young", Map.of("days", "7")).contains("7 jours"));
    }
}
