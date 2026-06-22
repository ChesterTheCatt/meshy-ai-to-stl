# Meshy To STL

Extensao Chrome local para encontrar arquivos `.meshy` carregados pela aba atual e converter em STL binario.

## Instalar

Antes de carregar a extensao, baixe os arquivos locais do decodificador:

```powershell
cd C:\Users\Luan\Desktop\meshy
powershell -ExecutionPolicy Bypass -File .\setup-vendor.ps1
```

1. Abra `chrome://extensions`.
2. Ative `Modo do desenvolvedor`.
3. Clique em `Carregar sem compactacao`.
4. Selecione a pasta `C:\Users\Luan\Desktop\meshy\chrome-extension`.

## Usar

1. Abra a pagina onde o modelo `.meshy` esta hospedado.
2. Recarregue a pagina para a extensao capturar o Network.
3. Clique no icone da extensao.
4. Selecione o `.meshy` encontrado.
5. Clique em `Baixar STL`.

## Observacoes

- A conversao roda localmente no navegador.
- `vendor/mesh_loader.js` e `vendor/mesh_loader.wasm` nao sao versionados neste repo; rode `setup-vendor.ps1` para baixar suas copias locais.
- O arquivo `.stl` baixado e binario, entao fica menor que STL ASCII.
- A extensao tambem consulta `performance.getEntriesByType("resource")`, entao muitos arquivos que aparecem no Network ja aparecem automaticamente no popup.
- Sites que bloqueiam download por permissao, login ou URL temporaria podem exigir que voce esteja logado na mesma sessao do Chrome.
