package fun.hardcoresmp.gatekeeper.discord;

import fun.hardcoresmp.gatekeeper.config.GatekeeperConfig;
import fun.hardcoresmp.gatekeeper.storage.Link;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService.LinkOutcome;
import fun.hardcoresmp.gatekeeper.whitelist.WhitelistService.UnlinkReason;
import java.nio.charset.StandardCharsets;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Predicate;
import java.util.function.Supplier;
import net.dv8tion.jda.api.Permission;
import net.dv8tion.jda.api.entities.Member;
import net.dv8tion.jda.api.entities.User;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.DefaultMemberPermissions;
import net.dv8tion.jda.api.interactions.commands.OptionMapping;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.CommandData;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SubcommandData;
import net.dv8tion.jda.api.utils.FileUpload;

/** Commandes slash : /whitelist (joueurs) et /wl info|list|remove|force (staff). */
final class DiscordCommands {

    record Reply(boolean success, String text) {}

    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("d MMMM yyyy 'à' HH:mm", Locale.FRENCH)
            .withZone(ZoneId.of("Europe/Paris"));

    private final Supplier<GatekeeperConfig> config;
    private final Supplier<WhitelistService> whitelist;
    private final Predicate<Member> isStaff;

    DiscordCommands(Supplier<GatekeeperConfig> config, Supplier<WhitelistService> whitelist, Predicate<Member> isStaff) {
        this.config = config;
        this.whitelist = whitelist;
        this.isStaff = isStaff;
    }

    static List<CommandData> definitions() {
        return List.of(
                Commands.slash("whitelist", "Te whitelister sur HARDCORE SMP avec ton pseudo Minecraft")
                        .addOption(OptionType.STRING, "pseudo", "Ton pseudo Minecraft Java", true),
                Commands.slash("wl", "Gestion de la whitelist (staff)")
                        .setDefaultPermissions(DefaultMemberPermissions.enabledFor(Permission.MANAGE_SERVER))
                        .addSubcommands(
                                new SubcommandData("info", "Voir le compte lié à un membre ou à un pseudo")
                                        .addOption(OptionType.USER, "membre", "Membre du Discord", false)
                                        .addOption(OptionType.STRING, "pseudo", "Pseudo Minecraft", false),
                                new SubcommandData("list", "Lister tous les joueurs whitelistés"),
                                new SubcommandData("remove", "Retirer un joueur de la whitelist")
                                        .addOption(OptionType.USER, "membre", "Membre du Discord", false)
                                        .addOption(OptionType.STRING, "pseudo", "Pseudo Minecraft", false),
                                new SubcommandData("force", "Lier de force un membre à un pseudo (sans vérification d'âge)")
                                        .addOption(OptionType.USER, "membre", "Membre du Discord", true)
                                        .addOption(OptionType.STRING, "pseudo", "Pseudo Minecraft", true)));
    }

    void handle(SlashCommandInteractionEvent event) {
        switch (event.getName()) {
            case "whitelist" -> selfWhitelist(event);
            case "wl" -> staff(event);
            default -> { }
        }
    }

    /** Texte de réponse pour chaque résultat possible d'une demande de whitelist. */
    Reply describe(LinkOutcome outcome, String requested) {
        GatekeeperConfig current = config.get();
        return switch (outcome) {
            case LinkOutcome.Linked linked -> new Reply(true, current.discordMessage("linked", Map.of("name", linked.link().name())));
            case LinkOutcome.AlreadyLinkedSame same -> new Reply(true, current.discordMessage("already-linked-same", Map.of("name", same.link().name())));
            case LinkOutcome.InvalidName ignored -> new Reply(false, current.discordMessage("invalid-name", Map.of()));
            case LinkOutcome.AccountTooYoung young -> new Reply(false, current.discordMessage("account-too-young", Map.of("days", String.valueOf(young.minDays()))));
            case LinkOutcome.AlreadyLinked already -> new Reply(false, current.discordMessage("already-linked", Map.of("name", already.existing().name())));
            case LinkOutcome.NameNotFound notFound -> new Reply(false, current.discordMessage("name-not-found", Map.of("name", sanitize(notFound.name()))));
            case LinkOutcome.TakenByOther taken -> new Reply(false, current.discordMessage("taken-by-other", Map.of("name", taken.existing().name())));
            case LinkOutcome.LookupFailed ignored -> new Reply(false, current.discordMessage("lookup-failed", Map.of("name", sanitize(requested))));
        };
    }

    private void selfWhitelist(SlashCommandInteractionEvent event) {
        String name = option(event, "pseudo").orElse("");
        event.deferReply(true).queue();
        User user = event.getUser();
        whitelist.get().requestLink(user.getId(), user.getTimeCreated().toInstant(), name).whenComplete((outcome, error) -> {
            Reply reply = error != null ? new Reply(false, config.get().discordMessage("error", Map.of())) : describe(outcome, name);
            event.getHook().sendMessage(reply.text()).setEphemeral(true).queue();
        });
    }

    private void staff(SlashCommandInteractionEvent event) {
        Member member = event.getMember();
        if (member == null || !isStaff.test(member)) {
            event.reply("❌ Commande réservée au staff.").setEphemeral(true).queue();
            return;
        }
        String sub = event.getSubcommandName() == null ? "" : event.getSubcommandName();
        event.deferReply(true).queue();
        WhitelistService service = whitelist.get();
        switch (sub) {
            case "info" -> {
                Optional<Link> link = target(event, service);
                event.getHook().sendMessage(link.map(DiscordCommands::describeLink).orElse("Aucun compte lié trouvé.")).queue();
            }
            case "list" -> {
                List<Link> links = service.allLinks().stream().sorted(Comparator.comparing(l -> l.name().toLowerCase(Locale.ROOT))).toList();
                StringBuilder text = new StringBuilder("**" + links.size() + " joueur(s) whitelisté(s)**\n");
                links.forEach(l -> text.append("• **").append(l.name()).append("** : <@").append(l.discordId()).append(">\n"));
                if (text.length() <= 1900) {
                    event.getHook().sendMessage(text.toString()).queue();
                } else {
                    StringBuilder file = new StringBuilder();
                    links.forEach(l -> file.append(l.name()).append(";").append(l.uuid()).append(";").append(l.discordId())
                            .append(";").append(DATE.format(l.linkedAt())).append("\n"));
                    event.getHook().sendMessage("**" + links.size() + " joueurs whitelistés** (liste complète en pièce jointe)")
                            .addFiles(FileUpload.fromData(file.toString().getBytes(StandardCharsets.UTF_8), "whitelist.csv")).queue();
                }
            }
            case "remove" -> {
                Optional<Link> link = target(event, service);
                if (link.isEmpty()) {
                    event.getHook().sendMessage("Aucun compte lié trouvé.").queue();
                    return;
                }
                service.unlink(link.get().uuid(), UnlinkReason.STAFF_REMOVED, member.getId()).whenComplete((removed, error) ->
                        event.getHook().sendMessage(error == null
                                ? "✅ **" + link.get().name() + "** a été retiré de la whitelist."
                                : "❌ Erreur pendant le retrait : " + error.getMessage()).queue());
            }
            case "force" -> {
                User user = event.getOption("membre", OptionMapping::getAsUser);
                String name = option(event, "pseudo").orElse("");
                if (user == null) {
                    event.getHook().sendMessage("❌ Indique un membre.").queue();
                    return;
                }
                service.forceLink(user.getId(), name, member.getId()).whenComplete((outcome, error) -> {
                    Reply reply = error != null ? new Reply(false, "❌ Erreur : " + error.getMessage()) : describe(outcome, name);
                    event.getHook().sendMessage(reply.text()).queue();
                });
            }
            default -> event.getHook().sendMessage("Sous-commande inconnue.").queue();
        }
    }

    private static Optional<Link> target(SlashCommandInteractionEvent event, WhitelistService service) {
        User user = event.getOption("membre", OptionMapping::getAsUser);
        if (user != null) return service.linkOfDiscord(user.getId());
        return option(event, "pseudo").flatMap(service::linkOfName);
    }

    private static String describeLink(Link link) {
        return "**" + link.name() + "**\n"
                + "• Discord : <@" + link.discordId() + ">\n"
                + "• UUID : `" + link.uuid() + "`\n"
                + "• Lié le " + DATE.format(link.linkedAt())
                + (Link.SELF.equals(link.linkedBy()) ? " (par le joueur)" : " (par <@" + link.linkedBy() + ">)");
    }

    private static Optional<String> option(SlashCommandInteractionEvent event, String name) {
        return Optional.ofNullable(event.getOption(name, OptionMapping::getAsString)).map(String::trim).filter(s -> !s.isEmpty());
    }

    /** Empêche un pseudo saisi d'utiliser la mise en forme Discord (mentions, gras…). */
    static String sanitize(String text) {
        String cut = text.length() > 32 ? text.substring(0, 32) + "…" : text;
        return cut.replaceAll("[*_`~|>@#]", "");
    }
}
