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
}

export {}
