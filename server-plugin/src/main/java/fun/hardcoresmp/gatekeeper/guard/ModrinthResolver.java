package fun.hardcoresmp.gatekeeper.guard;

import java.util.Collection;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

/** Identifie des fichiers (empreinte SHA-512) sur Modrinth. */
public interface ModrinthResolver {

    /** Projet Modrinth d'un fichier, avec ses dépendances obligatoires. */
    record Identified(String projectId, Set<String> requiredDependencies) {}

    /**
     * @return pour chaque empreinte connue de Modrinth, son projet. Les empreintes absentes du résultat sont inconnues.
     *         Échoue si Modrinth est injoignable.
     */
    CompletableFuture<Map<String, Identified>> identify(Collection<String> sha512s);
}
