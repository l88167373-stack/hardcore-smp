package fun.hardcoresmp.gatekeeper.command;

import fun.hardcoresmp.gatekeeper.GatekeeperPlugin;
import fun.hardcoresmp.gatekeeper.storage.Link;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.minimessage.tag.resolver.Placeholder;
import net.kyori.adventure.text.minimessage.tag.resolver.TagResolver;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/** /gatekeeper reload | info &lt;joueur&gt; | bypass &lt;joueur&gt; (permission hsmpgatekeeper.admin). */
public final class GatekeeperCommand implements BasicCommand {

    public static final String PERMISSION = "hsmpgatekeeper.admin";
    private static final MiniMessage MINI = MiniMessage.miniMessage();
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm", Locale.FRENCH)
            .withZone(ZoneId.of("Europe/Paris"));

    private final GatekeeperPlugin plugin;

    public GatekeeperCommand(GatekeeperPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public String permission() {
        return PERMISSION;
    }

    @Override
    public void execute(CommandSourceStack source, String[] args) {
        CommandSender sender = source.getSender();
        if (!sender.hasPermission(PERMISSION)) {
            sender.sendMessage(mm("<red>Tu n'as pas la permission d'utiliser cette commande."));
            return;
        }
        String sub = args.length > 0 ? args[0].toLowerCase(Locale.ROOT) : "";
        switch (sub) {
            case "reload" -> reload(sender);
            case "info" -> withTarget(sender, args, "info", target -> info(sender, target));
            case "bypass" -> withTarget(sender, args, "bypass", target -> toggleBypass(sender, target));
            default -> sender.sendMessage(mm("""
                    <gold><bold>HSMP Gatekeeper</bold></gold>
                    <yellow>/gatekeeper reload</yellow> <gray>recharge config.yml et reconnecte le bot Discord
                    <yellow>/gatekeeper info <joueur></yellow> <gray>compte Discord lié, bypass, statut
                    <yellow>/gatekeeper bypass <joueur></yellow> <gray>active / désactive le bypass (staff, tests)"""));
        }
    }

    @Override
    public Collection<String> suggest(CommandSourceStack source, String[] args) {
        if (args.length <= 1) {
            String start = args.length == 0 ? "" : args[0].toLowerCase(Locale.ROOT);
            return Stream.of("reload", "info", "bypass").filter(s -> s.startsWith(start)).toList();
        }
        if (args.length == 2 && !args[0].equalsIgnoreCase("reload")) {
            String start = args[1].toLowerCase(Locale.ROOT);
            return Bukkit.getOnlinePlayers().stream().map(Player::getName)
                    .filter(name -> name.toLowerCase(Locale.ROOT).startsWith(start)).toList();
        }
        return List.of();
    }

    private record Target(UUID uuid, String name) {}

    private void withTarget(CommandSender sender, String[] args, String sub, java.util.function.Consumer<Target> action) {
        if (args.length < 2) {
            sender.sendMessage(mm("<red>Utilisation : /gatekeeper " + sub + " <joueur>"));
            return;
        }
        Optional<Target> target = resolve(args[1]);
        if (target.isEmpty()) {
            sender.sendMessage(mm("<red>Joueur inconnu : <name>. Il doit être en ligne, whitelisté ou déjà venu sur le serveur.",
                    "name", args[1]));
            return;
        }
        action.accept(target.get());
    }

    private Optional<Target> resolve(String name) {
        Player online = Bukkit.getPlayerExact(name);
        if (online != null) return Optional.of(new Target(online.getUniqueId(), online.getName()));
        Optional<Link> link = plugin.whitelist().linkOfName(name);
        if (link.isPresent()) return Optional.of(new Target(link.get().uuid(), link.get().name()));
        OfflinePlayer cached = Bukkit.getOfflinePlayerIfCached(name);
        if (cached != null) return Optional.of(new Target(cached.getUniqueId(), cached.getName() == null ? name : cached.getName()));
        return Optional.empty();
    }

    private void reload(CommandSender sender) {
        List<String> problems = plugin.reloadGatekeeper();
        sender.sendMessage(mm("<green>Configuration rechargée.</green> <gray>Bot Discord : <state>",
                "state", plugin.config().discord().configured() ? "reconnexion en cours" : "désactivé (config incomplète)"));
        problems.forEach(problem -> sender.sendMessage(mm("<yellow>• <problem>", "problem", problem)));
    }

    private void info(CommandSender sender, Target target) {
        Optional<Link> link = plugin.whitelist().linkOf(target.uuid());
        boolean bypass = plugin.config().bypass().contains(target.uuid());
        sender.sendMessage(mm("<gold><bold><name></bold></gold> <dark_gray><uuid>", "name", target.name(), "uuid", target.uuid().toString()));
        if (link.isPresent()) {
            Link l = link.get();
            sender.sendMessage(mm("<gray>Discord : <white><id></white> <gray>(lié le <date>, <by>)",
                    "id", l.discordId(), "date", DATE.format(l.linkedAt()),
                    "by", Link.SELF.equals(l.linkedBy()) ? "par le joueur" : "par le staff"));
            String presence = switch (plugin.discordAccess().presence(l.discordId())) {
                case PRESENT -> "présent";
                case ABSENT -> "absent";
                case UNKNOWN -> "inconnue (bot non connecté)";
            };
            sender.sendMessage(mm("<gray>Présence sur le Discord : <white><presence>", "presence", presence));
        } else {
            sender.sendMessage(mm("<red>Aucun compte Discord lié : pas whitelisté."));
        }
        sender.sendMessage(mm("<gray>Bypass : <white><state>", "state", bypass ? "oui" : "non"));
    }

    private void toggleBypass(CommandSender sender, Target target) {
        boolean enabled = plugin.toggleBypass(target.uuid());
        sender.sendMessage(mm(enabled
                ? "<green>Bypass activé pour <name> : il passe toutes les vérifications du Gatekeeper."
                : "<yellow>Bypass retiré pour <name>.", "name", target.name()));
    }

    /**
     * MiniMessage avec des variables nommées, insérées telles quelles (jamais interprétées) :
     * mm("Bonjour <name>", "name", pseudo).
     */
    private static Component mm(String template, String... keyValues) {
        TagResolver.Builder resolvers = TagResolver.builder();
        for (int i = 0; i + 1 < keyValues.length; i += 2) resolvers.resolver(Placeholder.unparsed(keyValues[i], keyValues[i + 1]));
        return MINI.deserialize(template, resolvers.build());
    }
}
