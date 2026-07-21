const express = require('express');
const { Storage } = require('@google-cloud/storage');
const yaml = require('js-yaml');

const app = express();
const port = 3000;

// Google Cloud Storage Client initialisieren
const storage = new Storage();
const bucket = storage.bucket('okf-wiki-vault');

// --- 1. Funktion zum Abrufen und Parsen der OKF-Artefakte ---
async function fetchCloudArtifacts() {
    try {
        // Lade alle Dateien aus dem Bucket (nur aus dem 'artifacts/'-Ordner für den Graphen)
        const [files] = await bucket.getFiles({ prefix: 'artifacts/' });
        const artifacts = [];

        for (const file of files) {
            // Nur .md Dateien lesen
            if (!file.name.endsWith('.md')) continue;

            const [content] = await file.download();
            const text = content.toString('utf-8');

            // YAML-Frontmatter extrahieren (zwischen den ---)
            const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
            if (match) {
                try {
                    const metadata = yaml.load(match[1]);
                    artifacts.push({
                        name: metadata.name || file.name.replace('.md', ''),
                        type: metadata.type || 'unknown',
                        version: metadata.version || '1.0.0',
                        description: metadata.description || '',
                        runtime: metadata.runtime || 0,
                        steps: metadata.steps || 0,
                        tokens: metadata.tokens || 0,
                        fileName: file.name
                    });
                } catch (e) {
                    console.warn(`Fehler beim Parsen von ${file.name}:`, e.message);
                }
            }
        }
        return artifacts;
    } catch (error) {
        console.error('Fehler beim Zugriff auf Cloud Storage:', error.message);
        return [];
    }
}

// --- 2. API-Endpoint: Liefert den Mermaid-Code ---
app.get('/api/visualize', async (req, res) => {
    const artifacts = await fetchCloudArtifacts();

    // Wenn keine Artefakte gefunden wurden, zeige eine freundliche Info
    if (artifacts.length === 0) {
        return res.json({
            mermaid: 'graph TD\n    A["Noch keine OKF-Artefakte. Führe den Orchestrator aus!"]'
        });
    }

    // Generiere Mermaid Nodes und Edges
    let mermaid = 'graph TD\n';

    // Knoten definieren (mit Farbcodierung nach Typ)
    const nodes = artifacts.map(a => {
        let color = '#bbf'; // Standard: workflow-enforcement-prompt
        if (a.type === 'system-orchestration-prompt') color = '#f9f';
        if (a.type === 'agent-skill') color = '#bf0';
        if (a.type === 'lessons-learned') color = '#f99';

        return `    ${a.name.replace(/-/g, '_')}["${a.name} (v${a.version})"]:::${a.type.replace(/-/g, '_')}`;
    });

    mermaid += nodes.join('\n') + '\n';

    // Kanten definieren (einfache Evolution: Wir lassen den neuesten "Winner" auf den vorherigen zeigen)
    // In einer echten Umgebung würdest du hier die Eltern-Kind-Beziehungen aus den YAML-Files auslesen.
    // Für den MVP verbinden wir sie einfach in der Reihenfolge ihrer Erstellung.
    for (let i = 0; i < artifacts.length - 1; i++) {
        const current = artifacts[i].name.replace(/-/g, '_');
        const next = artifacts[i + 1].name.replace(/-/g, '_');
        mermaid += `    ${current} --> ${next}\n`;
    }

    // CSS für die Knoten (Mermaid Klassen)
    mermaid += `
    classDef system-orchestration-prompt fill:#f9f,stroke:#333,stroke-width:2px;
    classDef workflow-enforcement-prompt fill:#bbf,stroke:#333,stroke-width:2px;
    classDef agent-skill fill:#bf0,stroke:#333,stroke-width:2px;
    classDef lessons-learned fill:#f99,stroke:#333,stroke-width:2px;`;

    res.json({ mermaid });
});

// --- 3. Das Web-Dashboard (HTML + Mermaid) ---
app.get('/', (req, res) => {
    const html = `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>OKF Evolution Cloud Dashboard</title>
    <script type="module">
        import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
        mermaid.initialize({ startOnLoad: true, theme: 'dark' });
    </script>
    <style>
        body { background: #1e1e2e; color: #cdd6f4; font-family: 'Courier New', monospace; padding: 40px; }
        h1 { color: #cba6f7; font-size: 2.5rem; }
        .container { background: #313244; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); margin-top: 20px; }
        button { background: #89b4fa; color: #1e1e2e; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; margin-top: 15px; }
        button:hover { background: #89b4fa; opacity: 0.8; }
        .loader { text-align: center; color: #a6e3a1; }
        .error { color: #f38ba8; }
    </style>
</head>
<body>
    <h1>🧬 OKF Evolution Graph (Cloud Live)</h1>
    <p>Deine autonome Wissensdatenbank – synchronisiert mit dem <code>okf-wiki-vault</code> Bucket.</p>

    <div id="loading" class="loader">🌐 Lade Wissensgraphen aus der Google Cloud...</div>
    <div id="error" class="error" style="display:none;"></div>

    <div class="container">
        <div id="graph"></div>
    </div>

    <button id="refreshBtn">🔄 Graphen neu laden</button>

    <script>
        async function loadGraph() {
            const loadingEl = document.getElementById('loading');
            const errorEl = document.getElementById('error');
            const graphEl = document.getElementById('graph');

            loadingEl.style.display = 'block';
            errorEl.style.display = 'none';
            graphEl.innerHTML = '';

            try {
                const res = await fetch('/api/visualize');
                const data = await res.json();

                loadingEl.style.display = 'none';

                if (data.mermaid) {
                    graphEl.innerHTML = data.mermaid;
                    await mermaid.run({ nodes: [graphEl] });
                } else {
                    graphEl.innerHTML = '<p style="color:orange;">Keine Daten verfügbar.</p>';
                }
            } catch (e) {
                loadingEl.style.display = 'none';
                errorEl.style.display = 'block';
                errorEl.textContent = '❌ Fehler beim Laden des Graphen: ' + e.message;
            }
        }

        document.getElementById('refreshBtn').addEventListener('click', loadGraph);
        loadGraph();
    </script>
</body>
</html>
    `;
    res.send(html);
});

// Server starten
app.listen(port, () => {
    console.log(`🚀 OKF Cloud Dashboard live unter http://localhost:${port}`);
    console.log(`📦 Beobachtet den Bucket: gs://okf-wiki-vault/artifacts/`);
});
