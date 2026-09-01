# Site AJDAS — déploiement

Site de l'Association des Jeunes pour le Développement d'Adjarra Sota, avec espace administrateur pour publier projets, documents et photos.

## Ce que contient le dossier

- `public/index.html` — le site public (Accueil, Qui sommes-nous, Nos projets, Galerie, Documents, Contact)
- `public/admin.html` — l'espace administrateur (protégé par un code)
- `public/assets/logo.jpg` — le logo de l'association
- `worker.js` — le Cloudflare Worker qui gère l'API et l'espace admin
- `schema.sql` — la structure de la base de données D1
- `wrangler.toml` — la configuration du projet

## Déploiement (depuis ton téléphone, avec Termux ou un terminal)

### 1. Installer Wrangler (une seule fois)
```
npm install -g wrangler
wrangler login
```

### 2. Créer la base de données D1
```
wrangler d1 create ajdas_db
```
Copie l'identifiant `database_id` retourné et colle-le dans `wrangler.toml` à la place de `REMPLACER_PAR_ID_APRES_CREATION`.

Ensuite, applique la structure :
```
wrangler d1 execute ajdas_db --remote --file=./schema.sql
```

### 3. Créer le bucket R2 (stockage des fichiers/images)
```
wrangler r2 bucket create ajdas-files
```

### 4. Définir la clé de session
```
wrangler secret put SESSION_SECRET
```
→ entre une longue phrase aléatoire (sert uniquement à sécuriser la session, tu n'as pas besoin de t'en souvenir).

Le code d'accès à l'espace admin, lui, n'est **pas** un secret Cloudflare : il est stocké dans la base D1, avec la valeur par défaut **1234**. Tu pourras le changer à tout moment directement depuis l'espace admin (onglet **Paramètres**), sans avoir besoin de redéployer.

### 5. Déployer
```
wrangler deploy
```
Wrangler te donne une adresse du type `https://ajdas-site.<ton-compte>.workers.dev` — c'est le site en ligne.

### 6. Mettre le projet sur GitHub (optionnel mais recommandé)
```
git init
git add .
git commit -m "Site AJDAS"
```
Crée un dépôt sur GitHub puis :
```
git remote add origin <URL_DE_TON_DEPOT>
git push -u origin main
```

## Utiliser l'espace administrateur

Sur le site, clique sur le bouton **Gestion** tout en bas de la page, entre le code d'accès (**1234** par défaut), puis choisis l'onglet (Projets / Galerie / Documents), remplis le titre, la description et éventuellement une photo ou un fichier, puis clique sur **Publier**. Le contenu apparaît immédiatement sur le site public, dans l'onglet correspondant.

Pour changer le code d'accès, va dans l'onglet **Paramètres** de l'espace admin : entre le code actuel puis le nouveau code (au moins 4 caractères), deux fois pour confirmation.

## Pour la suite

- Remplacer les statistiques et textes de la page d'accueil par du contenu réel au fil du temps.
- Ajouter les vrais projets, documents (statuts, rapports...) et photos depuis l'espace admin.
