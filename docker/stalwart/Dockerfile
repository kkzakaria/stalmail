# Stalwart service — the STOCK image, only the entrypoint swapped for our restart
# supervisor (so the BFF can trigger the bootstrap→normal restart via the shared
# sentinel). The binary, default listeners, and config model are untouched.
FROM stalwartlabs/stalwart:v0.16

USER root
COPY docker/stalwart/entrypoint.sh /usr/local/bin/stalmail-supervisor
# /shared is the cross-container coordination volume (sentinel + setup flag). Ownership
# contract: this (stalwart) container owns the mountpoint so the supervisor can rm the
# sentinel; the app container writes to it as root (root writes succeed regardless, and
# unlink is governed by the stalwart-owned directory). 0775 keeps it group-writable.
RUN chmod +x /usr/local/bin/stalmail-supervisor && \
    mkdir -p /shared && chown stalwart:stalwart /shared && chmod 0775 /shared
USER stalwart

ENTRYPOINT ["/usr/local/bin/stalmail-supervisor"]
