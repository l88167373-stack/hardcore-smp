package fun.hardcoresmp.gatekeeper.publicconfig;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PublicConfigTest {

    @TempDir Path dir;

    @Test
    void laCopieEmbarqueeEstLaVraieConfigDuDepot() {
        PublicConfigService service = new PublicConfigService(dir, () -> null, Logger.getLogger("test"));
        PublicConfig config = service.current();
        assertEquals("copie embarquée", service.source());
        assertEquals(1, config.rulesVersion());
        assertEquals("1.0.0", config.minGuardVersion());
        assertNull(config.guardSha512(), "Guard pas encore publié (TODO)");
        assertNull(config.guardVersion());
        assertTrue(config.allowedMods().contains("P7dR8mSH"), "Fabric API autorisée");
        assertTrue(config.allowedMods().contains("AANobbMI"), "Sodium autorisé");
        assertTrue(config.allowedShaders().contains("HVnmMxH1"), "Complementary autorisé");
    }

    @Test
    void sansInternetLaConfigActuelleEstConservee() {
        PublicConfigService service = new PublicConfigService(dir, () -> "https://adresse.invalide.test/config/", Logger.getLogger("test"));
        PublicConfig before = service.current();
        service.refresh();
        assertEquals(before, service.current());
    }

    @Test
    void uneConfigIncompleteEstRefusee() {
        assertThrows(IllegalArgumentException.class, () -> PublicConfig.parse("{}", "{}"));
        assertThrows(IllegalArgumentException.class, () -> PublicConfig.parse(
                "{\"minLauncherVersion\":\"abc\",\"minGuardVersion\":\"1.0.0\",\"rulesVersion\":1,\"guard\":{\"sha512\":\"TODO\"},\"requiredMods\":[]}",
                "{\"mods\":[],\"resourcepacks\":[],\"shaders\":[]}"));
    }
}
