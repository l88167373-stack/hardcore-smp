package fun.hardcoresmp.guard;

import java.net.URI;
import java.nio.file.Path;
import java.util.List;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientConfigurationConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientConfigurationNetworking;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.impl.networking.RegistrationPayload;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConfirmScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Util;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * HSMP Guard : répond au défi du serveur HARDCORE SMP pendant la connexion,
 * et prévient le joueur s'il n'a pas lancé le jeu avec le launcher officiel.
 */
public final class GuardClient implements ClientModInitializer {

    private static final Logger LOG = LoggerFactory.getLogger("HSMP Guard");
    private static boolean warningShown;

    @Override
    public void onInitializeClient() {
        PayloadTypeRegistry.clientboundConfiguration().register(GuardPayloads.Challenge.TYPE, GuardPayloads.Challenge.CODEC);
        PayloadTypeRegistry.serverboundConfiguration().register(GuardPayloads.Response.TYPE, GuardPayloads.Response.CODEC);

        ClientConfigurationNetworking.registerGlobalReceiver(GuardPayloads.Challenge.TYPE, (challenge, context) -> {
            Minecraft client = context.client();
            Path gameDirectory = client.gameDirectory.toPath();
            List<String> packs = List.copyOf(client.options.resourcePacks);
            byte[] response = GuardResponse.build(challenge, gameDirectory, LaunchMarker.read(gameDirectory), version(), packs);
            context.responseSender().sendPacket(new GuardPayloads.Response(response));
            LOG.info("Défi du serveur reçu, réponse envoyée ({} octets)", response.length);
        });

        // Paper n'annonce pas ses canaux pendant la configuration, et Fabric n'annonce les siens qu'en réponse :
        // sans ce message, le serveur croit que le client n'écoute pas « hsmp:guard » et ne lui envoie jamais le défi.
        ClientConfigurationConnectionEvents.START.register((handler, client) -> announceChannel());

        // Lancé sans le launcher officiel : écran explicatif à l'ouverture du jeu.
        ScreenEvents.AFTER_INIT.register((client, screen, width, height) -> {
            if (warningShown || !(screen instanceof TitleScreen)) return;
            if (LaunchMarker.read(client.gameDirectory.toPath()).present()) return;
            warningShown = true;
            client.setScreenAndShow(officialLauncherScreen(client, screen));
        });
    }

    /** Envoie « minecraft:register » avec notre canal (classe interne de Fabric API, version figée par le launcher). */
    private static void announceChannel() {
        try {
            ClientConfigurationNetworking.send(new RegistrationPayload(RegistrationPayload.REGISTER, List.of(GuardPayloads.CHANNEL)));
        } catch (RuntimeException | LinkageError e) {
            // Fabric API a changé : le serveur refusera la connexion (« utilise le launcher officiel »), sans planter le jeu.
            LOG.error("Impossible d'annoncer le canal {} au serveur", GuardPayloads.CHANNEL, e);
        }
    }

    private static ConfirmScreen officialLauncherScreen(Minecraft client, net.minecraft.client.gui.screens.Screen previous) {
        return new ConfirmScreen(
                download -> {
                    if (download) Util.getPlatform().openUri(URI.create(GuardBuild.DOWNLOAD_URL));
                    client.setScreenAndShow(previous);
                },
                Component.literal("Utilise le launcher officiel HARDCORE SMP"),
                Component.literal("Le serveur HARDCORE SMP n'accepte que les joueurs qui lancent le jeu avec le launcher officiel. "
                        + "Télécharge-le, connecte-toi avec ton compte Microsoft et clique sur JOUER."),
                Component.literal("Télécharger le launcher"),
                Component.literal("Plus tard"));
    }

    static String version() {
        return FabricLoader.getInstance().getModContainer("hsmp-guard")
                .map(mod -> mod.getMetadata().getVersion().getFriendlyString())
                .orElse("0.0.0");
    }
}
