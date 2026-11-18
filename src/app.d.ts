declare global {
  namespace App {
    interface Locals {
      user: { email: string } | null
    }
    interface Error {
      message: string
      /** D-462: short reference id for unexpected (5xx) errors; matches the server log line. */
      ref?: string
    }
  }
  /** The release shown in the top bar (`git describe --tags`); set by vite.config.ts or the image build. */
  interface ImportMetaEnv {
    readonly VITE_APP_VERSION?: string
  }
}

export {}
