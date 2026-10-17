package fun.hardcoresmp.gatekeeper.config;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.minimessage.tag.resolver.Placeholder;
import net.kyori.adventure.text.minimessage.tag.resolver.TagResolver;

/** Messages en jeu (MiniMessage) construits à partir de la configuration actuelle. */
public final class Texts {

    private static final MiniMessage MINI = MiniMessage.miniMessage();
    private final Supplier<GatekeeperConfig> config;

    public Texts(Supplier<GatekeeperConfig> config) {
        this.config = config;
    }

    /** Message de config avec les variables &lt;discord&gt; et &lt;name&gt;. Les valeurs ne sont jamais interprétées. */
    public Component render(String key, String name) {
        return render(key, Map.of("name", name == null ? "" : name));
    }

    /**
     * Message de config avec ses variables. &lt;discord&gt; et &lt;download&gt; sont toujours disponibles.
     * Les valeurs (pseudo, nom de mod…) sont insérées telles quelles, jamais interprétées.
     */
    public Component render(String key, Map<String, String> variables) {
        GatekeeperConfig current = config.get();
        String invite = GatekeeperConfig.isTodo(current.discordInvite()) ? "(lien du Discord)" : current.discordInvite();
        String download = GatekeeperConfig.isTodo(current.launcherDownload()) ? "(lien du launcher sur le Discord)" : current.launcherDownload();
        List<TagResolver> resolvers = new ArrayList<>();
        resolvers.add(Placeholder.unparsed("discord", invite));
        resolvers.add(Placeholder.unparsed("download", download));
        variables.forEach((name, value) -> resolvers.add(Placeholder.unparsed(name, value)));
        return MINI.deserialize(current.message(key), TagResolver.resolver(resolvers));
    }

    public Component render(String key) {
        return render(key, Map.of());
    }
}
