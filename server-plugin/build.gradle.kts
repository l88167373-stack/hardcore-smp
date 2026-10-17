plugins {
    java
    id("com.gradleup.shadow") version "9.6.1"
}

group = "fun.hardcoresmp"
version = "0.1.0"
description = "HSMP Gatekeeper : whitelist Discord, contrôle à la connexion et HSMP Guard pour HARDCORE SMP"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

val paperApi = "io.papermc.paper:paper-api:26.2.build.134-stable"
// Fournie par Paper 26.2 (META-INF/libraries.list) : on ne l'embarque pas.
val sqlite = "org.xerial:sqlite-jdbc:3.49.1.0"

dependencies {
    compileOnly(paperApi)
    compileOnly(sqlite)

    // Bot Discord, embarqué et relocalisé (voir shadowJar) pour ne jamais entrer en conflit
    // avec le bot du pont chat déjà installé sur le serveur.
    implementation("net.dv8tion:JDA:6.7.0") {
        exclude(module = "opus-java") // audio : inutile
        exclude(module = "tink") // chiffrement vocal : inutile
        exclude(group = "org.slf4j") // fourni par Paper
    }

    testImplementation(paperApi)
    testImplementation(sqlite)
    testImplementation("org.mockbukkit.mockbukkit:mockbukkit-v26.2:4.117.0")
    testImplementation(platform("org.junit:junit-bom:6.1.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks {
    compileJava {
        options.encoding = "UTF-8"
        options.release = 25
        options.compilerArgs.addAll(listOf("-Xlint:all", "-Xlint:-serial", "-Xlint:-processing"))
    }

    compileTestJava {
        options.encoding = "UTF-8"
    }

    processResources {
        filteringCharset = "UTF-8"
        val props = mapOf("version" to project.version)
        inputs.properties(props)
        filesMatching("plugin.yml") { expand(props) }
        // Copie embarquée de config/ (utilisée tant que la config en ligne n'est pas joignable).
        from(rootProject.file("../config")) {
            include("launcher.json", "allowlist.json", "rules.json")
            into("public-config")
        }
    }

    jar {
        archiveClassifier = "sans-dependances"
    }

    shadowJar {
        archiveBaseName = "HSMPGatekeeper"
        archiveClassifier = ""
        val libs = "fun.hardcoresmp.gatekeeper.libs"
        relocate("net.dv8tion.jda", "$libs.jda")
        relocate("okhttp3", "$libs.okhttp3")
        relocate("okio", "$libs.okio")
        relocate("kotlin", "$libs.kotlin")
        relocate("com.fasterxml.jackson", "$libs.jackson")
        relocate("com.neovisionaries.ws", "$libs.websocket")
        relocate("org.apache.commons.collections4", "$libs.collections4")
        relocate("gnu.trove", "$libs.trove")
        relocate("org.jetbrains.annotations", "$libs.annotations")
        relocate("org.intellij.lang.annotations", "$libs.intellij")
        mergeServiceFiles()
        exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/versions/*/module-info.class", "module-info.class")
    }

    build {
        dependsOn(shadowJar)
    }

    test {
        useJUnitPlatform()
        // SQLite charge une bibliothèque native (comme sur le serveur Paper).
        jvmArgs("--enable-native-access=ALL-UNNAMED")
        testLogging {
            events("failed")
            exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
        }
    }
}
