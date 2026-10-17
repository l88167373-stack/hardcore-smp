package fun.hardcoresmp.gatekeeper.whitelist;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import fun.hardcoresmp.gatekeeper.Fakes;
import fun.hardcoresmp.gatekeeper.config.GatekeeperConfig;
import fun.hardcoresmp.gatekeeper.config.Texts;
import fun.hardcoresmp.gatekeeper.storage.Database;
import fun.hardcoresmp.gatekeeper.storage.Link;
import fun.hardcoresmp.gatekeeper.storage.LinkStore;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService.LinkOutcome;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService.LoginDecision;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService.UnlinkReason;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class WhitelistServiceTest {

    static final UUID STEVE = UUID.fromString("069a79f4-44e9-4726-a5be-fca90e38aaf5");
    static final UUID ALEX = UUID.fromString("ec561538-f3fd-461d-aff5-086b22154bce");
    static final String STEVE_DISCORD = "111111111111111111";
    static final String ALEX_DISCORD = "222222222222222222";
    static final Instant NOW = Instant.parse("2026-10-17T12:00:00Z");
    static final Instant OLD_ACCOUNT = NOW.minus(Duration.ofDays(400));

    @TempDir Path dir;
    Database database;
    LinkStore links;
    Fakes.Mojang mojang;
    Fakes.Server server;
    Fakes.Discord discord;
    GatekeeperConfig config;
    WhitelistService service;

    static GatekeeperConfig defaultConfig() {
        var stream = WhitelistServiceTest.class.getClassLoader().getResourceAsStream("config.yml");
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(new InputStreamReader(stream, StandardCharsets.UTF_8));
        return GatekeeperConfig.from(yaml);
    }

    @BeforeEach
    void setUp() throws Exception {
        database = new Database(dir.resolve("gatekeeper.db"));
        links = new LinkStore(database);
        links.load();
        mojang = new Fakes.Mojang().add("Steve", STEVE).add("Alex", ALEX);
        server = new Fakes.Server();
        discord = new Fakes.Discord();
        discord.members.addAll(Set.of(STEVE_DISCORD, ALEX_DISCORD));
        config = defaultConfig();
        service = newService();
    }

    WhitelistService newService() {
        return new WhitelistService(links, mojang, server, () -> discord, () -> config, new Texts(() -> config),
                Clock.fixed(NOW, ZoneOffset.UTC), Logger.getLogger("test"));
    }

    @AfterEach
    void tearDown() {
        database.close();
    }

    @Test
    void unPseudoValideWhitelisteDonneLeRoleEtEstEnregistre() {
        LinkOutcome outcome = service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "  steve ").join();
        Link link = assertInstanceOf(LinkOutcome.Linked.class, outcome).link();
        assertEquals("Steve", link.name(), "le pseudo est enregistré avec la casse officielle de Mojang");
        assertEquals(STEVE, link.uuid());
        assertEquals(Link.SELF, link.linkedBy());
        assertTrue(server.whitelisted.contains(STEVE));
        assertTrue(discord.withRole.contains(STEVE_DISCORD));
        assertEquals(1, discord.logs.size());
        assertEquals(LoginDecision.ALLOW, service.loginDecision(STEVE));
    }

    @Test
    void pseudoMalEcrit() {
        assertInstanceOf(LinkOutcome.InvalidName.class, service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Steve le boss").join());
        assertInstanceOf(LinkOutcome.InvalidName.class, service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "ab").join());
        assertTrue(server.whitelisted.isEmpty());
    }

    @Test
    void compteDiscordTropRecent() {
        Instant young = NOW.minus(Duration.ofDays(2));
        var outcome = assertInstanceOf(LinkOutcome.AccountTooYoung.class, service.requestLink(STEVE_DISCORD, young, "Steve").join());
        assertEquals(7, outcome.minDays());
    }

    @Test
    void pseudoInexistantOuMojangEnPanne() {
        assertInstanceOf(LinkOutcome.NameNotFound.class, service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Inconnu123").join());
        mojang.down = true;
        assertInstanceOf(LinkOutcome.LookupFailed.class, service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Steve").join());
        assertTrue(links.all().isEmpty());
    }

    @Test
    void unDiscordNePeutLierQuUnSeulCompteMinecraft() {
        service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Steve").join();
        var already = assertInstanceOf(LinkOutcome.AlreadyLinked.class, service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Alex").join());
        assertEquals("Steve", already.existing().name());
        assertInstanceOf(LinkOutcome.AlreadyLinkedSame.class, service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "STEVE").join());
    }

    @Test
    void unCompteMinecraftNePeutEtreLieQuAUnSeulDiscord() {
        service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Steve").join();
        var taken = assertInstanceOf(LinkOutcome.TakenByOther.class, service.requestLink(ALEX_DISCORD, OLD_ACCOUNT, "Steve").join());
        assertEquals(STEVE_DISCORD, taken.existing().discordId());
    }

    @Test
    void leStaffPeutForcerEtRemplacerUnLien() {
        service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Steve").join();
        // Steve (Discord) passe sur le compte Alex : l'ancien compte Steve est retiré.
        var forced = assertInstanceOf(LinkOutcome.Linked.class, service.forceLink(STEVE_DISCORD, "Alex", "999999999999999999").join());
        assertEquals("999999999999999999", forced.link().linkedBy());
        assertFalse(server.whitelisted.contains(STEVE));
        assertTrue(server.kicked.contains(STEVE));
        assertTrue(server.whitelisted.contains(ALEX));
        assertEquals(1, links.size());
    }

    @Test
    void forcerIgnoreLAgeDuCompte() {
        assertInstanceOf(LinkOutcome.Linked.class, service.forceLink(STEVE_DISCORD, "Steve", "999999999999999999").join());
    }

    @Test
    void departDuDiscordRetireDeLaWhitelistEtKick() {
        service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Steve").join();
        discord.members.remove(STEVE_DISCORD);
        assertTrue(service.unlinkDiscord(STEVE_DISCORD, UnlinkReason.LEFT_DISCORD, "test").join().isPresent());
        assertFalse(server.whitelisted.contains(STEVE));
        assertEquals(List.of(STEVE), server.kicked);
        assertTrue(links.byUuid(STEVE).isEmpty());
        assertEquals(LoginDecision.DENY_NOT_WHITELISTED, service.loginDecision(STEVE));
    }

    @Test
    void retraitParLeStaffRetireAussiLeRole() {
        service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Steve").join();
        service.unlink(STEVE, UnlinkReason.STAFF_REMOVED, "staff").join();
        assertFalse(discord.withRole.contains(STEVE_DISCORD));
    }

    @Test
    void reconciliationRetireLesMembresPartisPendantQueLeServeurEtaitEteint() {
        service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Steve").join();
        service.requestLink(ALEX_DISCORD, OLD_ACCOUNT, "Alex").join();
        discord.members = new HashSet<>(Set.of(ALEX_DISCORD));
        assertEquals(1, service.reconcile().join());
        assertTrue(links.byUuid(STEVE).isEmpty());
        assertTrue(links.byUuid(ALEX).isPresent());
    }

    @Test
    void reconciliationReporteeSiLeBotNEstPasPret() {
        service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Steve").join();
        discord.members = null;
        assertEquals(0, service.reconcile().join());
        assertTrue(links.byUuid(STEVE).isPresent());
    }

    @Test
    void reconciliationAnnuleeSiElleRetireraitPresqueTousLesJoueurs() {
        for (int i = 0; i < 6; i++) {
            UUID uuid = UUID.randomUUID();
            String id = "30000000000000000" + i;
            mojang.add("Joueur" + i, uuid);
            discord.members.add(id);
            service.requestLink(id, OLD_ACCOUNT, "Joueur" + i).join();
        }
        discord.members = new HashSet<>(); // liste vide : intention « Server Members » oubliée ?
        assertEquals(0, service.reconcile().join());
        assertEquals(6, links.size());
        assertTrue(discord.logs.stream().anyMatch(log -> log.title().contains("annulée")));
    }

    @Test
    void decisionsALaConnexion() {
        assertEquals(LoginDecision.DENY_NOT_WHITELISTED, service.loginDecision(STEVE));
        service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Steve").join();
        assertEquals(LoginDecision.ALLOW, service.loginDecision(STEVE));

        discord.members = null; // bot déconnecté
        assertEquals(LoginDecision.ALLOW, service.loginDecision(STEVE), "offline-policy: allow par défaut");

        discord.members = new HashSet<>(); // parti du Discord pendant que le serveur était éteint
        assertEquals(LoginDecision.DENY_LEFT_DISCORD, service.loginDecision(STEVE));
    }

    @Test
    void leBypassPasseToutesLesVerifications() {
        YamlConfiguration yaml = new YamlConfiguration();
        yaml.set("bypass.uuids", List.of(STEVE.toString()));
        config = GatekeeperConfig.from(yaml);
        assertEquals(LoginDecision.ALLOW_BYPASS, service.loginDecision(STEVE));
    }

    @Test
    void lesLiensSurviventAuRedemarrage() {
        service.requestLink(STEVE_DISCORD, OLD_ACCOUNT, "Steve").join();
        links.audit("TEST", STEVE, STEVE_DISCORD, "x").join();
        database.close();
        try (Database reopened = new Database(dir.resolve("gatekeeper.db"))) {
            LinkStore store = new LinkStore(reopened);
            store.load();
            assertEquals("Steve", store.byUuid(STEVE).orElseThrow().name());
            assertEquals(STEVE, store.byDiscordId(STEVE_DISCORD).orElseThrow().uuid());
            assertEquals(STEVE, store.byName("sTeVe").orElseThrow().uuid());
            store.rename(STEVE, "SteveV2").join();
            assertEquals("SteveV2", store.byUuid(STEVE).orElseThrow().name());
        } catch (Exception e) {
            throw new AssertionError(e);
        }
        // La base est fermée : on en rouvre une pour tearDown().
        try {
            database = new Database(dir.resolve("autre.db"));
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }
}
