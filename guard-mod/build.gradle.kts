import java.security.SecureRandom
import java.util.Base64

plugins {
    // Minecraft 26.x n'est plus obfusqué : plugin Loom sans « remapping » ni mappings.
    id("net.fabricmc.fabric-loom") version "1.19.1"
}

group = "fun.hardcoresmp"
version = "1.0.0"
base { archivesName = "hsmp-guard" }

java {
    toolchain { languageVersion = JavaLanguageVersion.of(25) }
}

val proguard: Configuration by configurations.creating

dependencies {
    minecraft("com.mojang:minecraft:26.2")
    implementation("net.fabricmc:fabric-loader:0.19.5")
    implementation("net.fabricmc.fabric-api:fabric-api:0.161.0+26.2")
    proguard("com.guardsquare:proguard-base:7.10.0")
}

// ─────────────────────────────────────────────────────────────────────────────
//  Clé de signature HMAC et lien de téléchargement, injectés à la compilation.
//
//  - Release (GitHub Actions) : clé = secret HSMP_GUARD_KEY (base64, 32 octets), stable entre les builds
//    d'une même version. On la change à chaque nouvelle version du Guard (rotation).
//  - Build local sans secret : une NOUVELLE clé aléatoire est générée à chaque build et écrite dans
//    build/guard-key.txt, à copier dans guard.keys du config.yml du plugin.
//  La clé n'est jamais écrite en clair dans le code : elle est découpée en deux tableaux (XOR).
// ─────────────────────────────────────────────────────────────────────────────
val generatedSources = layout.buildDirectory.dir("generated/sources/hsmp/java")
val keyFile = layout.buildDirectory.file("guard-key.txt")

val generateGuardBuild = tasks.register("generateGuardBuild") {
    description = "Génère la classe GuardBuild (clé HMAC + lien de téléchargement)"
    val secret = providers.environmentVariable("HSMP_GUARD_KEY").orElse(providers.gradleProperty("hsmpGuardKey"))
    val launcherJson = rootProject.file("../config/launcher.json")
    outputs.dir(generatedSources)
    outputs.file(keyFile)
    outputs.upToDateWhen { false }
    doLast {
        val random = SecureRandom()
        val key: ByteArray = if (secret.isPresent) {
            Base64.getDecoder().decode(secret.get().trim())
        } else {
            ByteArray(32).also { random.nextBytes(it) }
        }
        require(key.size >= 32) { "HSMP_GUARD_KEY doit faire au moins 32 octets (base64)" }
        val mask = ByteArray(key.size).also { random.nextBytes(it) }
        val masked = ByteArray(key.size) { (key[it].toInt() xor mask[it].toInt()).toByte() }

        @Suppress("UNCHECKED_CAST")
        val links = (groovy.json.JsonSlurper().parse(launcherJson) as Map<String, Any?>)["links"] as Map<String, Any?>
        val download = (links["download"] as String?)?.takeUnless { it.startsWith("TODO_") } ?: "https://hardcore-smp.mine.fun"

        fun javaBytes(bytes: ByteArray) = bytes.joinToString(", ") { it.toString() }
        val dir = generatedSources.get().asFile.resolve("fun/hardcoresmp/guard")
        dir.mkdirs()
        dir.resolve("GuardBuild.java").writeText(
            """
            |package fun.hardcoresmp.guard;
            |
            |/** Généré à la compilation : ne pas modifier. */
            |final class GuardBuild {
            |    static final String DOWNLOAD_URL = "${download.replace("\"", "")}";
            |    private static final byte[] A = { ${javaBytes(mask)} };
            |    private static final byte[] B = { ${javaBytes(masked)} };
            |
            |    private GuardBuild() {}
            |
            |    static byte[] key() {
            |        byte[] key = new byte[A.length];
            |        for (int i = 0; i < key.length; i++) key[i] = (byte) (A[i] ^ B[i]);
            |        return key;
            |    }
            |}
            |""".trimMargin()
        )
        val encoded = Base64.getEncoder().encodeToString(key)
        keyFile.get().asFile.writeText(encoded + "\n")
        if (!secret.isPresent) {
            logger.warn("HSMP Guard : clé de test générée pour ce build → build/guard-key.txt (à mettre dans guard.keys du plugin)")
        }
    }
}

sourceSets.main {
    java.srcDir(generatedSources)
}

tasks.compileJava {
    dependsOn(generateGuardBuild)
    options.encoding = "UTF-8"
    options.release = 25
}

tasks.processResources {
    val props = mapOf("version" to project.version)
    inputs.properties(props)
    filesMatching("fabric.mod.json") { expand(props) }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Obfuscation ProGuard : complique l'extraction de la clé et la modification du Guard.
//  Résultat : build/libs/hsmp-guard-<version>-protege.jar (celui que le launcher installe).
// ─────────────────────────────────────────────────────────────────────────────
val java25 = javaToolchains.launcherFor { languageVersion = JavaLanguageVersion.of(25) }
val jdkClasses = layout.buildDirectory.dir("proguard/jdk")

val extractJdkClasses = tasks.register<Exec>("extractJdkClasses") {
    description = "Extrait java.base du JDK 25 (bibliothèque de référence pour ProGuard)"
    val home = java25.map { it.metadata.installationPath.asFile }
    outputs.dir(jdkClasses)
    doFirst { jdkClasses.get().asFile.deleteRecursively() }
    executable = home.get().resolve("bin/jimage" + if (System.getProperty("os.name").startsWith("Windows")) ".exe" else "").absolutePath
    args("extract", "--dir", jdkClasses.get().asFile.absolutePath, "--include", "regex:/java\\.base/.*",
        home.get().resolve("lib/modules").absolutePath)
}

val obfuscate = tasks.register<JavaExec>("obfuscate") {
    description = "Obfusque le jar du Guard avec ProGuard"
    dependsOn(tasks.jar, extractJdkClasses)
    val input = tasks.jar.flatMap { it.archiveFile }
    val output = layout.buildDirectory.file("libs/hsmp-guard-${project.version}-protege.jar")
    val libraries = sourceSets.main.get().compileClasspath
    inputs.file(input)
    inputs.file("proguard.pro")
    outputs.file(output)
    classpath = proguard
    mainClass = "proguard.ProGuard"
    javaLauncher = java25
    argumentProviders.add(CommandLineArgumentProvider {
        listOf(
            "-injars", input.get().asFile.absolutePath,
            "-outjars", output.get().asFile.absolutePath,
            "-libraryjars", jdkClasses.get().asFile.resolve("java.base").absolutePath,
            "-libraryjars", libraries.files.filter { it.exists() }.joinToString(File.pathSeparator) { it.absolutePath },
            "@" + file("proguard.pro").absolutePath
        )
    })
}

tasks.assemble { dependsOn(obfuscate) }
