# Ícone

`icon.svg` é a fonte: a fresa, de frente, tocando a superfície da peça (a linha azul).
`icon-maskable.svg` é a mesma arte reduzida para a zona segura dos ícones
adaptáveis do Android. Os PNGs em `public/icons/` saem destes SVGs com o Chrome
em modo headless e o `sips`:

```bash
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$C" --headless=new --screenshot=icon-1024.png --window-size=1024,1024 "file://$PWD/icon.svg"
sips -z 180 180 icon-1024.png --out ../public/icons/icon-180.png
```
