const vscode = require('vscode');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

let chatView; // référence à la WebviewView quand elle est créée
let currentHtml = `<p>Pose une question avec la commande <b>Hello Flask: Ask</b>.</p>`;

function htmlShell(body) {
  return `<!doctype html>
  <html><body style="font-family:system-ui,Segoe UI,Arial;padding:10px">
    ${body}
  </body></html>`;
}

function setChatHtml(html) {
  currentHtml = html;
  if (chatView) {
    try { chatView.webview.html = htmlShell(currentHtml); } catch {}
  }
}

async function ping() {
  try {
    const r = await fetch('http://127.0.0.1:8000/ping');
    const j = await r.json();
    vscode.window.showInformationMessage(`Flask dit: ${j.message}`);
  } catch (e) {
    vscode.window.showErrorMessage(`Ping Flask KO: ${e.message}`);
  }
}

async function ask() {
  const prompt = await vscode.window.showInputBox({ prompt: 'Demande au serveur Flask' });
  if (!prompt) return;

  // Assure la création/visibilité de la vue AVANT la mise à jour
  await vscode.commands.executeCommand('workbench.view.extension.helloFlask.container');

  try {
    const r = await fetch('http://127.0.0.1:8000/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const j = await r.json();

    setChatHtml(`
      <h3>Question</h3><pre>${escapeHtml(prompt)}</pre>
      <h3>Réponse</h3><pre>${escapeHtml(j.reply || '(vide)')}</pre>
    `);
  } catch (e) {
    vscode.window.showErrorMessage(`Ask Flask KO: ${e.message}`);
  }
}

function activate(context) {
  // Provider de la vue latérale
  const provider = {
    resolveWebviewView(webviewView) {
      chatView = webviewView;
      webviewView.onDidDispose(() => { chatView = undefined; });
      webviewView.webview.options = { enableScripts: true };
      webviewView.webview.html = htmlShell(currentHtml);
    }
  };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('helloFlask.chatView', provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('helloFlask.ping', ping),
    vscode.commands.registerCommand('helloFlask.ask', ask),
  );
}

function deactivate() {}
module.exports = { activate, deactivate };
