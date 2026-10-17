# Instalação no Proxmox

O RLight roda num container Debian 12 próprio, com IP fixo, só na rede local
([ADR-0001](../docs/adr/0001-servidor-no-proxmox.md)):

```
iPhone ──https──▶ Caddy (TLS por DNS-01) ──▶ app estático
                       └── /ws ──▶ servidor do RLight ──telnet──▶ placa FluidNC
```

## Uma vez, por quem administra

1. **Container:** Debian 12, sem privilégios, 1 núcleo, 512 MB, 4 GB, IP estático,
   *start at boot*. Chave SSH de quem vai instalar.
2. **DNS local** no roteador apontando o domínio para o IP do container. Nenhum
   registro público: o endereço só existe dentro de casa.
3. **Token da Cloudflare** com permissão *Edit zone DNS* só na zona do domínio, para
   o certificado do Let's Encrypt. Gravado no container por quem administra:

   ```bash
   read -rsp 'Token: ' T && printf 'CF_API_TOKEN=%s\n' "$T" > /etc/rlight/cloudflare.env && unset T
   ```

## Instalar ou atualizar

Dentro do container, como root:

```bash
curl -fsSL https://raw.githubusercontent.com/willianrupert/rlight-pendant/main/deploy/install.sh | bash
```

Ou, com o repositório já clonado, `bash /opt/rlight/app/deploy/install.sh`. Rodar de
novo atualiza para o `main`.

- Endereço da placa e domínio: `/etc/rlight/rlight.env`.
- Logs: `journalctl -u rlight-server -f` e `journalctl -u rlight-caddy -f`.
- O servidor sozinho só lê da placa (`$CD`, `$I`, `$G`, `$#`, `?`). Comandos só saem
  quando uma tela com o controle pede, e passam pela policy do core.
