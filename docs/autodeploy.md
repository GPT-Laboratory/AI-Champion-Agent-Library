# Pull-based autodeploy: käyttöönotto

Tuotantopalvelin hakee julkaisut reposta
**https://github.com/GPT-Laboratory/AI-Champion-Agent-Library.git**.
Palvelin tarkistaa suurimman `v*`-tagin SSH-allekirjoituksen ja sen, että commit
kuuluu `main`-historiaan. Hyväksytty julkaisu käynnistää `deploy.sh`:n.
GitHubista ei avata yhteyttä palvelimelle eikä GitHubiin tallenneta palvelimen
kirjautumisavaimia. Tämä ohje ja tiedostot valmistellaan repossa; seuraavat
GitHub-asetukset ja palvelinkomennot on tehtävä erikseen.

## 1. GitHub: tee kerran

Organisaatiossa `GPT-Laboratory`:

1. Vaadi jäseniltä 2FA.
2. Luo `deployers`-tiimi, lisää julkaisijat ja anna tiimille repon write-oikeus.
3. Lisää `.github/CODEOWNERS`. Lähtömalli on `deploy/CODEOWNERS.example`.
   Esimerkin `* @GPT-Laboratory/deployers` vaatii tämän tiimin omistajaksi kaikille
   tiedostoille; vaihda tiimi, jos koodikatselmointi kuuluu toiselle ryhmälle.
4. Luo aktiivinen `main`-branch ruleset: PR pakollinen, vähintään yksi hyväksyntä,
   Code Owner -hyväksyntä, vanhentuneiden hyväksyntöjen hylkäys, ei force pushia,
   ei poistoa, tyhjä bypass-lista. Lisää projektin CI-tarkistukset vaadituiksi,
   jos ne on otettu käyttöön.
5. Luo aktiivinen tag ruleset kohteelle `v*`: **Restrict creations**,
   **Restrict updates**, **Restrict deletions**. Bypass-oikeus vain tiimille
   `GPT-Laboratory/deployers`. Tämä vastaa liitteen käyttöoikeusmallia.
   Käytännössä julkaistuja tageja ei saa siirtää tai poistaa: palvelin hylkää
   viimeksi julkaistun tagin muutoksen. Halutessanne estäkää muutokset/poistot
   lisäksi erillisellä rulesetillä, jossa ei ole bypass-oikeuksia.

Rulesetien ja Code Owner -vaatimusten saatavuus riippuu GitHub-tilauksesta ja repon
näkyvyydestä. Katso [GitHubin ruleset-ohje](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)
ja [sääntöjen merkitykset](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).
Allekirjoitusavainlistan tarkistus tehdään silti aina palvelimella.

## 2. Valitse palvelimen käyttäjä ja säilytä nykyinen data

Komennot alla olettavat käyttäjän `deploy` ja hakemiston `/home/deploy/app`.
Jos palvelu on jo käytössä toisella rootless Podman -käyttäjällä, käytä mieluiten
sitä ja vaihda käyttäjä, ryhmä, HOME sekä polut ohjeessa ja systemd-uniteissa.
Uusi käyttäjä ei näe vanhan käyttäjän kontteja eikä volumeja. Pelkkä `deploy`-käyttäjän
luominen ei siis siirrä nykyistä palvelua tai vapauta porttia 3000.

Ota ensin varmuuskopio kirjautumistietokannasta. Suoraan `podman run` -komennolla
luodussa kontissa se voi olla kontin omassa `/app/runtime/auth`-hakemistossa.
SQLite-tietokanta WAL-tiedostoineen kopioidaan vanhan sovelluksen ollessa pysäytettynä.
Compose-käyttöön siirrettäessä vanha tietokanta pitää tarvittaessa siirtää uuteen
`auth-data`-volumeen ennen tuotantoliikenteen avaamista.

Nykyisen Compose-projektin nimen voi tarkistaa vanhana Podman-käyttäjänä:

```sh
podman inspect --format '{{index .Config.Labels "io.podman.compose.project"}}' aic-agent-library
```

Säilytä sama `COMPOSE_PROJECT_NAME`, jotta olemassa olevat volumet löytyvät.
Suoralla `podman run` -komennolla luodulla kontilla ei ole tätä labelia.

## 3. Palvelimen perustaminen VPN-yhteydellä

Tarvitaan Linux/systemd, Bash, Git SSH-allekirjoitustuella (Git 2.34+), OpenSSH,
flock, curl, rootless Podman ja podman-compose. Podman Compose -version pitää tukea
`--env-file`, `up --no-build` ja `up --no-recreate` -valintoja.
Käytä palvelimella testattua versiota; konttiajoa ei ole validoitu tässä kehitysympäristössä.

Esimerkiksi Debian/Ubuntu-palvelimella järjestelmänvalvojana:

```sh
sudo apt-get update
sudo apt-get install git openssh-client curl podman podman-compose uidmap \
  slirp4netns fuse-overlayfs dbus-user-session util-linux
# Vain jos luodaan uusi käyttäjä; katso ensin edellisen luvun migraatio-ohje.
sudo adduser --disabled-password --gecos '' deploy
sudo -u deploy -H git clone \
  https://github.com/GPT-Laboratory/AI-Champion-Agent-Library.git /home/deploy/app
```

Jos käytät valmista tuotantokloonia, varmista sen `origin`. Se ei saa osoittaa
kehittäjän forkkiin. Vaihda tarvittaessa vain palvelimen kloonin remote:

```sh
sudo -u deploy -H git -C /home/deploy/app remote set-url origin \
  https://github.com/GPT-Laboratory/AI-Champion-Agent-Library.git
```

Julkinen repo ei tarvitse tunnuksia. Yksityinen repo tarvitsee palvelimelle
read-only-kloonauksen mahdollistavan tunnuksen, esimerkiksi vain tähän repoon
rajatun SSH deploy keyn. Lisää silloin sen julkinen avain GitHubin Deploy keys
-asetuksiin ilman write-oikeutta ja käytä SSH-remotea. Tämä lukuavain on eri asia
kuin kehittäjien allekirjoitusavaimet. Varmista SSH host key etukäteen; ajastettu
haku ei kysy salasanaa tai hyväksy interaktiivisia kehotteita.

Rootless Podmanin socket käyntiin ja käyttäjän systemd käyntiin myös ilman kirjautumista:

```sh
sudo loginctl enable-linger deploy
deploy_uid=$(id -u deploy)
sudo systemctl start "user@${deploy_uid}.service"
sudo -u deploy env XDG_RUNTIME_DIR="/run/user/$deploy_uid" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$deploy_uid/bus" \
  systemctl --user enable --now podman.socket
sudo -u deploy env XDG_RUNTIME_DIR="/run/user/$deploy_uid" podman info
```

`deploy.sh` asettaa `XDG_RUNTIME_DIR`:n itse ja tarkistaa socketin ennen kontin vaihtoa.
Käyttäjä ei tarvitse Docker-ryhmää eikä sudo-oikeuksia deploy-ajossa.

## 4. Asenna luotetut tiedostot ja asetukset

Tee komennot tarkistetun, `main`-haaraan yhdistetyn version hakemistossa.
Asennus kopioi pollerin rootin omistukseen; tagi ei päivitä sitä itsestään.

```sh
cd /home/deploy/app
sudo install -d -m 755 /etc/autodeploy /etc/aic-agent-library
sudo install -o root -g root -m 755 deploy/autodeploy /usr/local/bin/autodeploy
sudo install -o root -g root -m 755 deploy/autodeploy-notify /usr/local/bin/autodeploy-notify
sudo install -o root -g root -m 644 deploy/systemd/autodeploy.service \
  deploy/systemd/autodeploy.timer deploy/systemd/autodeploy-notify.service /etc/systemd/system/

# Seuraavat neljä tiedostoa luodaan VAIN ensimmäisellä asennuskerralla.
# Päivityksissä säilytä aiemmat arvot ja avaimet.
sudo install -o root -g root -m 644 deploy/allowed_signers.example /etc/autodeploy/allowed_signers
sudo install -o root -g root -m 644 deploy/autodeploy.env.example /etc/autodeploy/autodeploy.env
sudo install -o root -g root -m 600 deploy/notify.env.example /etc/autodeploy/notify.env
sudo install -o root -g deploy -m 640 .env.example /etc/aic-agent-library/app.env
```

Muokkaa tämän jälkeen:

```sh
sudoedit /etc/autodeploy/allowed_signers
sudoedit /etc/autodeploy/autodeploy.env
sudoedit /etc/autodeploy/notify.env
sudoedit /etc/aic-agent-library/app.env
```

**allowed_signers:** yksi oikea julkinen allekirjoitusavain per rivi, esimerkiksi:

```text
alice@example.com namespaces="git" ssh-ed25519 AAAA_TAHAN_OIKEA_JULKINEN_AVAIN
```

Poista esimerkin kommenttimerkki vain, kun olet korvannut koko avaimen oikealla.
Tiedosto pysyy rootin omistuksessa. Avaimen lisääminen/myöhempi poisto myöntää/peruu
tulevien julkaisujen hyväksynnän; jo käynnissä oleva koodi ei sillä pysähdy.
Hyväksytty julkaisija saa käytännössä suorittaa koodia deploy-käyttäjänä ja lukea
sovelluksen salaisuuksia. [Gitin SSH-luottamusmalli](https://git-scm.com/docs/git-config#Documentation/git-config.txt-gpgsshallowedSignersFile).

**autodeploy.env:** checkoutin polku, sovelluksen env-polku, Compose-projektin nimi
ja tilahakemisto. Ei `export`-rivejä eikä `$(...)`-laajennuksia. Jos käytät muuta
käyttäjää, muuta lisäksi kummankin system-palvelun `User`/`Group` ja autodeploy-palvelun
`HOME`, mieluiten `systemctl edit` -drop-inillä. Polleri pakottaa allekirjoituslistan
polun itse; repon paikallinen Git-asetus ei korvaa sitä.

**app.env:** tuotannon `ORIGIN`, `AUTH_COOKIE_SECURE=true`, whitelist, lähettäjä ja
SMTP- tai Brevo-asetukset sekä tarvittaessa `OPENAI_API_KEY`. Vaihda kaikki malliarvot.
Tiedosto luetaan kontin ympäristöksi, ei shell-skriptinä, eikä sitä lisätä Gitiin.
`AUTH_ENABLED=false` ohittaa kirjautumisen vain, jos se on nimenomaisesti tarkoitus.

**notify.env:** lisää pitkä satunnainen topic tai käyttöoikeuksin rajattu oma ntfy:

```text
NTFY_URL=https://ntfy.sh/OMA-PITKA-SATUNNAINEN-TOPIC
# Omalla/tunnistautumista vaativalla palvelulla tarvittaessa:
# NTFY_TOKEN=...
```

Tilaa topic ntfy-sovelluksessa. Tyhjä URL jättää ulkoisen ilmoituksen pois.
Ilmoituksessa on palvelimen nimi ja viittaus lokiin; lokien 30 viimeistä riviä ei
lähetetä, koska ne voivat sisältää henkilötietoja tai ympäristöasetuksia.
HTTP-virhe tekee ilmoituspalvelun ajosta epäonnistuneen. [Ntfyn julkaisuohje](https://docs.ntfy.sh/publish/).

## 5. Tee ensimmäinen allekirjoitettu julkaisu

Yhdistä ensin nämä deploy-tiedostot `main`-haaraan PR:n kautta. Valitse uusi,
vielä käyttämätön versionumero, joka on nykyisiä `v*`-tageja suurempi.
Tee kehittäjän koneella, jonka `origin` on organisaation tuotantorepo:

```sh
git config gpg.format ssh
git config user.signingkey ~/.ssh/id_ed25519.pub
git fetch origin main
git tag -s v1.4.0 origin/main -m 'Release 1.4.0'
git push origin refs/tags/v1.4.0
```

Korvaa versionumero oikealla uudella versiolla. Yksityisen avaimen pitää olla
käytettävissä paikallisesti tai ssh-agentissa. Julkisen vastinavaimen pitää olla
palvelimen `allowed_signers`-tiedostossa. GitHubin Verified-merkintää varten avaimen
voi lisätä myös GitHub-profiilin signing keyksi; palvelin luottaa omaan listaansa.

Kaikki `v*`-tagit ovat julkaisuehdokkaita, myös esimerkiksi `v2.0.0-rc1`.
Käyttäkää siksi tuotantorepossa sovittua `vMAJOR.MINOR.PATCH`-käytäntöä.
Valinta käyttää Gitin versionumerolajittelua, ei tagin aikaleimaa. Uusin virheellinen
tagi pysäyttää julkaisun; polleri ei etsi sen takaa vanhempaa kelvollista tagia.

## 6. Testaa palvelimella ja ota ajastin käyttöön

```sh
sudo systemctl daemon-reload
sudo systemctl start autodeploy.service
sudo journalctl -u autodeploy.service -n 80 --no-pager
sudo -u deploy env XDG_RUNTIME_DIR="/run/user/$(id -u deploy)" \
  podman ps --filter name=aic-agent-library
```

Tarkista myös selaimessa kirjautumiskoodin toimitus ja pääsy sovellukseen sekä
Try It Out, jos se on käytössä. `/health` tarkistaa katalogitietokannan, ei Brevon,
SMTP:n tai OpenAI-tunnuksen toimivuutta.

Ensimmäinen vaihto suoraan käynnistetystä kontista säilyttää vanhan kontin nimellä
`aic-agent-library-previous`. Tarkista/migroi sen tiedot ja poista sitten vain kontti:

```sh
# Aja nykyisenä Podman-käyttäjänä, älä rootina:
podman rm aic-agent-library-previous
```

Seuraava deploy pysähtyy, jos tällainen käsiteltävä varakontti on yhä olemassa.
Normaalin Compose-kontin varakopio poistetaan onnistuneen deployn jälkeen.

Varmista ilmoitukset (komento lähettää oikean testihälytyksen asetettuun topiciin):

```sh
sudo systemctl start autodeploy-notify.service
sudo journalctl -u autodeploy-notify.service -n 20 --no-pager
```

Kun ensimmäinen julkaisu ja ilmoitukset toimivat:

```sh
sudo systemctl enable --now autodeploy.timer
systemctl list-timers autodeploy.timer
```

Ajastin käynnistyy minuutin kuluttua bootista ja uudelleen noin minuutti edellisen
ajon päättymisestä (lisäksi enintään 15 sekuntia hajontaa). Hidas build ei käynnistä
rinnakkaista deployta. Ajon aikaraja on 30 minuuttia; nosta tarvittaessa palvelimen
ensimmäistä mallilatausta varten systemd-drop-inissä `TimeoutStartSec`.

### Sovelluksen käynnistys palvelimen rebootissa

Ajastin ohittaa jo julkaistun tagin, joten se ei yksin käynnistä pysähtynyttä konttia.
Asenna ensimmäisen onnistuneen julkaisun jälkeen mukana oleva user-unit:

```sh
sudo -u deploy mkdir -p /home/deploy/.config/systemd/user
sudo install -o deploy -g deploy -m 644 deploy/systemd-user/aic-agent-library.service \
  /home/deploy/.config/systemd/user/aic-agent-library.service
deploy_uid=$(id -u deploy)
sudo -u deploy env XDG_RUNTIME_DIR="/run/user/$deploy_uid" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$deploy_uid/bus" systemctl --user daemon-reload
sudo -u deploy env XDG_RUNTIME_DIR="/run/user/$deploy_uid" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$deploy_uid/bus" \
  systemctl --user enable --now aic-agent-library.service
```

Unit käynnistää olemassa olevan kontin, ei rakenna tai julkaise uutta versiota.
Varmista `/usr/bin/podman`-polku omalla palvelimella. Testaa reboot huoltoikkunassa.

## 7. Päivittäinen käyttö ja virhetilanteet

Tavallinen julkaisu: hyväksy PR mainiin, luo uusi allekirjoitettu tagi ja puske se.
Palvelimella ei tarvitse ajaa manuaalisesti `podman run`- tai Compose-komentoja.

```sh
sudo journalctl -u autodeploy.service -f
sudo systemctl status autodeploy.timer autodeploy.service
sudo cat /home/deploy/.local/state/aic-deploy/release
```

`release` sisältää onnistuneen tagin, tagiobjektin tunnisteen ja commitin.
`current` sisältää viimeisen onnistuneen deployn commitin ja imagen.
Epäonnistumista ei merkitä julkaistuksi, joten ajastin yrittää uudelleen ja voi
lähettää uuden hälytyksen. Pysäytä ajastin tutkimisen ajaksi:

```sh
sudo systemctl stop autodeploy.timer
# Tarkista status ja odota jo käynnissä olevan ajon valmistumista.
sudo systemctl status autodeploy.service
```

Älä muuta checkoutia kesken ajon. Työkopion on oltava puhdas. Tavalliset käsiajot
käyttävät samaa lukkoa kuin polleri. Käsin `deploy.sh` ei itsessään tarkista tagin
allekirjoitusta; tuotannossa käytä normaalisti `systemctl start autodeploy.service`.

Deploy rakentaa imaget ennen vanhan kontin pysäyttämistä, varmistaa whitelistin
ja sähköpostiasetusten olemassaolon, vaihtaa kontin ja tarkistaa imagen sekä
`/health`-vastauksen. Vaihdossa on lyhyt käyttökatko. Virheessä säilytetty vanha
kontti käynnistetään takaisin asetuksineen. SIGKILL, sähkökatko tai epäonnistunut
palautus voi vaatia ylläpitäjän toimia. Tarkista tällöin molemmat kontinimet.

Palautus ei peru yhteiseen volumeen jo tehtyjä tietokantamuutoksia. Pidä migraatiot
taaksepäin yhteensopivina ja ota varmuuskopiot. Try It Out -työt voivat katketa.
Julkaisuimaget säilyvät levyllä: valvo levytilaa, älä poista volumeja siivouksessa.

Julkaistua tagia ei siirretä eikä poisteta. Viimeksi julkaistun tagin muutos/poisto
hylätään, samoin historian taaksepäin vievä julkaisu. Tarkoituksellinen palautus
tehdään uudella revert-commitilla mainiin ja uudella suuremmalla tagilla.
Epäonnistuneen julkaisun jälkeen checkout voi olla uudemmassa commitissa kuin
käynnissä oleva kontti; Podman ja tilatiedostot kertovat käynnissä olevan version.

Rootin omistamat `/usr/local/bin/autodeploy*` ja systemd-unitit päivitetään erikseen
luvun 4 install-komennoilla. Älä ylikirjoita asetuksia tai avainlistaa päivityksessä.
Aja unit-muutosten jälkeen `sudo systemctl daemon-reload`.

## Testit ja erot liitteen minimiversioon

```sh
bash -n deploy.sh deploy/autodeploy deploy/autodeploy-notify
python3 scripts/test-deploy.py
python3 scripts/test-autodeploy.py
python3 scripts/test-autodeploy-notify.py
```

Git-testit käyttävät oikeita paikallisia repoja ja SSH-allekirjoituksia.
Konttimoottori ja curl on testituplattu; testit eivät lähetä ilmoituksia.
Todellinen rootless Podman / Compose -ajo, Node-ympäristötarkistus, sähköpostitoimitus
ja reboot-palautuminen on vielä hyväksymistestattava palvelimella.

Liitteen perusmalli säilyy. Lisänä ovat lukitus, atominen tilatiedosto,
muutetun/poistetun viimeisen julkaisutagin tarkistus, allekirjoitetun tagin nimen
vastaavuus haettuun viitteeseen ja deployn healthcheck/palautus.
`main` haetaan eksplisiittisesti `origin/main`-viitteeseen. Tagin sijaan checkout
tehdään tarkistettuun commit-tunnisteeseen. Puhtaan checkoutin vaatimus estää
`checkout --force` -komennon hiljaisen paikallisten muutosten hävittämisen.
Ntfy saa lyhyen ilmoituksen raakojen lokien sijaan, ja ajastus lasketaan edellisen
ajon päättymisestä. GitHubin ja palvelimen asetuksia ei muuteta näillä repossa
olevilla tiedostoilla ennen käyttöönoton komentojen suorittamista.
