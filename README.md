# Agentia Doctor DX

Setup, auth and skills health check for Agentia CLI.

Built for the Agentia Headless Virtual Hackathon as an oclif plugin on top of
the public `agentia` CLI. Read only. It never writes credentials and never
imports private Agentia internals.

## Install

```sh
npm install
npm run build
agentia plugins link .
```

## Usage

```sh
agentia doctor
agentia doctor --json
agentia doctor --story US-1234
```

Checks CICD credentials, CRT `ready:true` state with `missing` and `issues`
details, AI credentials, CLI freshness versus Agent Skills staleness risk, and
project config presence. Every failure prints the exact fix command, such as
`agentia setup` or `agentia setup skills update --target agents --no-prompt`.

## License

MIT
