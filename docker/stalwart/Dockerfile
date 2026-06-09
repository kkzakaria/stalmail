# Stalwart service — the STOCK image, only the entrypoint swapped for our restart
# supervisor (so the BFF can trigger the bootstrap→normal restart via the shared
# sentinel). The binary, default listeners, and config model are untouched.
FROM stalwartlabs/stalwart:v0.16

USER root
COPY docker/stalwart/entrypoint.sh /usr/local/bin/stalmail-supervisor
RUN chmod +x /usr/local/bin/stalmail-supervisor && \
    mkdir -p /shared && chown stalwart:stalwart /shared
USER stalwart

ENTRYPOINT ["/usr/local/bin/stalmail-supervisor"]
