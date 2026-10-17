package fun.hardcoresmp.gatekeeper.login;

import com.destroystokyo.paper.profile.PlayerProfile;
import fun.hardcoresmp.gatekeeper.config.Texts;
import fun.hardcoresmp.gatekeeper.whitelist.DiscordAccess;
import fun.hardcoresmp.gatekeeper.whitelist.DiscordAccess.LogEntry;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService.LoginDecision;
import io.papermc.paper.connection.PlayerLoginConnection;
import io.papermc.paper.event.connection.PlayerConnectionValidateLoginEvent;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.logging.Logger;
import net.kyori.adventure.text.Component;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/**
 * Vérification n°1 à la connexion : whitelisté ET lié à un membre présent sur le Discord.
 * (Les vérifications du HSMP Guard s'ajoutent en phase 5, pendant la phase de configuration.)
 *
 * On ne « force » jamais l'entrée : si Minecraft refuse déjà (bannissement…), on laisse son message.
 */
public final class LoginGate implements Listener {

    private final Supplier<WhitelistService> whitelist;
    private final Supplier<DiscordAccess> discord;
    private final Texts texts;
    private final Logger log;

    public LoginGate(Supplier<WhitelistService> whitelist, Supplier<DiscordAccess> discord, Texts texts, Logger log) {
        this.whitelist = whitelist;
        this.discord = discord;
        this.texts = texts;
        this.log = log;
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onValidateLogin(PlayerConnectionValidateLoginEvent event) {
        // Cet événement arrive aussi en fin de phase de configuration : on ne vérifie qu'à la connexion.
        if (!(event.getConnection() instanceof PlayerLoginConnection login)) return;
        PlayerProfile profile = login.getAuthenticatedProfile();
        if (profile == null || profile.getId() == null) return;

        UUID uuid = profile.getId();
        String name = profile.getName() == null ? uuid.toString() : profile.getName();
        LoginDecision decision = whitelist.get().loginDecision(uuid);
        Component refusal = switch (decision) {
            case ALLOW, ALLOW_BYPASS -> null;
            case DENY_NOT_WHITELISTED -> texts.render("not-whitelisted", name);
            case DENY_LEFT_DISCORD -> texts.render("left-discord", name);
            case DENY_DISCORD_OFFLINE -> texts.render("discord-offline", name);
        };
        if (refusal == null) {
            // Le pseudo a peut-être changé depuis la whitelist : on garde le plus récent.
            whitelist.get().linkOf(uuid).filter(link -> !link.name().equals(name))
                    .ifPresent(link -> whitelist.get().rename(uuid, name));
            return;
        }
        event.kickMessage(refusal);
        log.info("Connexion refusée pour " + name + " (" + uuid + ") : " + decision);
        discord.get().log(new LogEntry(LogEntry.Kind.DENIED, "Connexion refusée : " + name,
                reason(decision) + "\nUUID : `" + uuid + "`"));
    }

    static String reason(LoginDecision decision) {
        return switch (decision) {
            case DENY_NOT_WHITELISTED -> "Pas whitelisté (aucun compte Discord lié).";
            case DENY_LEFT_DISCORD -> "N'est plus sur le Discord.";
            case DENY_DISCORD_OFFLINE -> "Bot Discord déconnecté (offline-policy: deny).";
            case ALLOW, ALLOW_BYPASS -> "Autorisé.";
        };
    }
}
