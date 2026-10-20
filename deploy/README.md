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
2. **DNS:** um registro A apontando o domínio para o IP interno do container, sem
   proxy (na Cloudflare, nuvem cinza). De fora de casa ele não leva a nada. Também
   serve uma entrada estática no DNS do roteador.
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

## Se o IP da placa mudar

O certo é reservar o IP da placa no roteador (no MikroTik: IP → DHCP Server →
Leases → a placa → Make Static). Se mesmo assim ele mudar, o servidor acha a
placa sozinho (`server/src/discover.ts`): na primeira conexão ele guarda o
endereço e o MAC que a placa diz no `$I` em `RLIGHT_STATE_DIR/board.json`; se
ela some por 30 s, bate à porta de cada endereço da mesma rede /24 (abre e
fecha, sem mandar nada), acha o MAC na tabela ARP e confirma com `$I` só naquele
endereço. Sem achar, tenta de novo em 2, 4, 8 e até 15 minutos. Mudar
`RLIGHT_BOARD_HOST` à mão no `rlight.env` vence o que o servidor aprendeu.
