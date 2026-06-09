export const fr = {
  wizard: {
    nav: { back: 'Retour', next: 'Suivant' },
    steps: {
      welcome: 'Bienvenue',
      domain: 'Domaine',
      dns: 'DNS',
      account: 'Compte',
      recap: 'Récapitulatif',
    },
    error: { title: 'Une erreur est survenue', retry: 'Réessayer' },
    welcome: {
      title: 'Configurons votre serveur mail',
      subtitle: 'Quelques étapes et votre boîte est prête.',
      language: 'Langue',
      start: 'Commencer',
    },
    domain: {
      title: 'Votre domaine',
      hostname: 'Nom d’hôte public',
      hostnameHint: 'ex. mail.exemple.fr',
      domain: 'Domaine email',
      domainHint: 'ex. exemple.fr',
      dnsWarning: 'Ce nom d’hôte ne pointe pas encore vers ce serveur.',
    },
    dns: {
      title: 'Fournisseur DNS',
      provider: 'Fournisseur',
      manual: 'Manuel (je gère mes enregistrements)',
      secret: 'Clé API',
      secretHint: 'Jamais affichée après validation.',
    },
    account: {
      title: 'Compte administrateur',
      name: 'Nom d’utilisateur',
      email: 'Adresse email',
      password: 'Mot de passe',
      strength: { weak: 'Faible', medium: 'Moyen', strong: 'Fort' },
    },
    recap: {
      title: 'Récapitulatif',
      submit: 'Configurer',
      hostname: 'Nom d’hôte',
      domain: 'Domaine',
      dns: 'DNS',
      account: 'Administrateur',
    },
    restart: {
      title: 'Configuration en cours',
      subtitle: 'Le serveur redémarre, un instant…',
      timeout: 'Cela prend plus longtemps que prévu.',
    },
  },
} as const

// DeepRecord<T> enforces the same nested key structure as T, but allows any string values.
type DeepRecord<T> = {
  [K in keyof T]: T[K] extends Record<string, unknown> ? DeepRecord<T[K]> : string
}

export const en: DeepRecord<typeof fr> = {
  wizard: {
    nav: { back: 'Back', next: 'Next' },
    steps: {
      welcome: 'Welcome',
      domain: 'Domain',
      dns: 'DNS',
      account: 'Account',
      recap: 'Summary',
    },
    error: { title: 'Something went wrong', retry: 'Retry' },
    welcome: {
      title: 'Let’s set up your mail server',
      subtitle: 'A few steps and your inbox is ready.',
      language: 'Language',
      start: 'Get started',
    },
    domain: {
      title: 'Your domain',
      hostname: 'Public hostname',
      hostnameHint: 'e.g. mail.example.com',
      domain: 'Email domain',
      domainHint: 'e.g. example.com',
      dnsWarning: 'This hostname does not point to this server yet.',
    },
    dns: {
      title: 'DNS provider',
      provider: 'Provider',
      manual: 'Manual (I manage my records)',
      secret: 'API key',
      secretHint: 'Never shown after you continue.',
    },
    account: {
      title: 'Administrator account',
      name: 'Username',
      email: 'Email address',
      password: 'Password',
      strength: { weak: 'Weak', medium: 'Medium', strong: 'Strong' },
    },
    recap: {
      title: 'Summary',
      submit: 'Set up',
      hostname: 'Hostname',
      domain: 'Domain',
      dns: 'DNS',
      account: 'Administrator',
    },
    restart: {
      title: 'Setting things up',
      subtitle: 'The server is restarting, one moment…',
      timeout: 'This is taking longer than expected.',
    },
  },
}
