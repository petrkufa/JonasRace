# JonasRace

3D multiplayerová závodní hra na motorkách pro Android a web, určená pro děti (ovládání jedním prstem).

## Hlavní funkce

- **Multiplayer pro 2–4 hráče** (přes internet bez vlastního serveru i v lokální síti / prohlížeči), možnost tréninku i v 1 hráči.
- **Náhodně generovaná pobřežní trať** ze startu do cíle před každým závodem (krátká / střední / dlouhá).
- **Ovládání jedním prstem:**
  - přiložení a držení prstu = plyn,
  - posun prstu doleva/doprava = zatáčení a náklon motorky,
  - puštění prstu = brzdění / zpomalení.
- **Herní prvky na trati:** červenobílá svodidla (bezpečný odraz zpět na silnici), turbo pásy, sbírání zlatých mincí, vyhýbání se kuželům a loužím, jemné strkání mezi motorkami.
- **HUD a zvuky:** `Score`, `Speed km/h`, kruhová minimapa celé trati, barevný analogový otáčkoměr a syntetizované zvuky.

## Spuštění na PC / v prohlížeči

```bash
npm install
npm run dev
```

Pro produkční sestavení webu:

```bash
npm run build
```

## Instalační balíček pro Android (`.apk`)

Po každém pushi na větev `main` se v záložce **Actions** na GitHubu automaticky sestaví instalační balíček `JonasRace-debug.apk`, který si můžeš stáhnout rovnou do telefonu Android.
