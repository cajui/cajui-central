# Mosquitto with Cajuí's configuration. Credentials are generated on first start into the
# /secrets volume and reloaded when producer credentials change. Build from the repo root.
FROM eclipse-mosquitto:2.0.22
COPY mosquitto/mosquitto.conf mosquitto/acl mosquitto/broker.sh mosquitto/credentials.sh /cajui/
COPY examples/mqtt/sample.json /cajui/examples/sample.json
EXPOSE 1883
VOLUME ["/secrets", "/mosquitto/data"]
ENTRYPOINT ["sh", "/cajui/broker.sh"]
