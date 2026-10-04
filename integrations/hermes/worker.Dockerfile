# Operator first builds the audited Hermes image locally at the recorded commit.
# No downloads, installation or upstream mutation happen in this derived image.
FROM radar-hermes-audited:local
COPY --chown=hermes:hermes plugins/hermes-radar /opt/radar/plugins/hermes-radar
COPY --chown=hermes:hermes integrations/hermes/worker.py /opt/radar/integrations/hermes/worker.py
# The pin is build provenance, not a signature or a complete source integrity proof.
COPY integrations/hermes/upstream.commit /opt/hermes/.radar-upstream-pin
ENV RADAR_HERMES_SOURCE=/opt/hermes PYTHONDONTWRITEBYTECODE=1 HERMES_HOME=/tmp/hermes
USER hermes
WORKDIR /opt/radar
ENTRYPOINT ["/opt/hermes/.venv/bin/python", "/opt/radar/integrations/hermes/worker.py"]
