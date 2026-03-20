# WSO2 Micro Integrator 4.4.0 with Kafka connector pre-installed
# Built from a local wso2mi-4.4.0.zip distribution.

FROM eclipse-temurin:17-jre-jammy

# ── 0. Install utilities ─────────────────────────────────────────────────────────
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    curl ca-certificates unzip netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# ── 1. Create wso2carbon user ────────────────────────────────────────────────────
RUN groupadd -r wso2carbon && useradd -r -g wso2carbon -m -d /home/wso2carbon wso2carbon

# ── 2. Copy and extract the local MI distribution ────────────────────────────────
COPY wso2mi-4.4.0.zip /tmp/wso2mi.zip
RUN unzip -q /tmp/wso2mi.zip -d /home/wso2carbon \
    && rm /tmp/wso2mi.zip \
    && chown -R wso2carbon:wso2carbon /home/wso2carbon/wso2mi-4.4.0

ARG MI_HOME=/home/wso2carbon/wso2mi-4.4.0

# ── 3. Download Kafka connector ZIP into synapse-libs directory ─────────────────
ARG KAFKA_CONN_VER=3.2.0
RUN mkdir -p ${MI_HOME}/repository/deployment/server/synapse-libs \
    && curl -fsSL \
    "https://github.com/wso2-extensions/esb-connector-kafka/releases/download/v${KAFKA_CONN_VER}/kafkaTransport-connector-${KAFKA_CONN_VER}.zip" \
    -o ${MI_HOME}/repository/deployment/server/synapse-libs/kafkaTransport-connector-${KAFKA_CONN_VER}.zip \
    && chown -R wso2carbon:wso2carbon ${MI_HOME}/repository/deployment/server/synapse-libs

# ── 4. Download Kafka inbound endpoint ZIP from GitHub Releases ──────────────────
ARG KAFKA_INBOUND_VER=2.0.6
RUN curl -fsSL \
    "https://github.com/wso2-extensions/esb-inbound-kafka/releases/download/v${KAFKA_INBOUND_VER}/mi-inbound-kafka-${KAFKA_INBOUND_VER}.zip" \
    -o /tmp/kafka-inbound.zip \
    && unzip -o /tmp/kafka-inbound.zip -d /tmp/kafka-inbound \
    && find /tmp/kafka-inbound -name "*.jar" -exec cp {} ${MI_HOME}/dropins/ \; \
    && rm -rf /tmp/kafka-inbound /tmp/kafka-inbound.zip

# ── 5. Download WSO2 orbit bundles for Kafka (dropins) ────────────────────────────
# Per https://mi.docs.wso2.com/en/latest/reference/connectors/kafka-connector/setting-up-kafka/
RUN curl -fsSL \
    "https://repo1.maven.org/maven2/org/wso2/orbit/io/confluent/kafka-avro-serializer/7.6.0.wso2v1/kafka-avro-serializer-7.6.0.wso2v1.jar" \
    -o ${MI_HOME}/dropins/kafka-avro-serializer-7.6.0.wso2v1.jar \
    && curl -fsSL \
    "https://repo1.maven.org/maven2/org/wso2/orbit/io/confluent/kafka-schema-serializer/7.6.0.wso2v1/kafka-schema-serializer-7.6.0.wso2v1.jar" \
    -o ${MI_HOME}/dropins/kafka-schema-serializer-7.6.0.wso2v1.jar \
    && curl -fsSL \
    "https://repo1.maven.org/maven2/org/wso2/orbit/io/confluent/kafka-schema-registry-client/7.6.0.wso2v1/kafka-schema-registry-client-7.6.0.wso2v1.jar" \
    -o ${MI_HOME}/dropins/kafka-schema-registry-client-7.6.0.wso2v1.jar \
    && chown -R wso2carbon:wso2carbon ${MI_HOME}/dropins/

# ── 6. Download Kafka client JARs and dependencies (lib) ─────────────────────────
RUN curl -fsSL \
    "https://repo1.maven.org/maven2/org/apache/kafka/kafka-clients/3.6.1/kafka-clients-3.6.1.jar" \
    -o ${MI_HOME}/lib/kafka-clients-3.6.1.jar \
    && curl -fsSL \
    "https://packages.confluent.io/maven/io/confluent/common-config/7.6.0/common-config-7.6.0.jar" \
    -o ${MI_HOME}/lib/common-config-7.6.0.jar \
    && curl -fsSL \
    "https://packages.confluent.io/maven/io/confluent/common-utils/7.6.0/common-utils-7.6.0.jar" \
    -o ${MI_HOME}/lib/common-utils-7.6.0.jar \
    && curl -fsSL \
    "https://repo1.maven.org/maven2/com/yammer/metrics/metrics-core/2.2.0/metrics-core-2.2.0.jar" \
    -o ${MI_HOME}/lib/metrics-core-2.2.0.jar

# ── 6b. Copy pre-built Avro OSGi bundle with proper version exports ──────────────
# The auto-converted bundle from lib/ lacks version exports, breaking OSGi resolution
COPY org.apache.avro-1.11.3.jar ${MI_HOME}/dropins/org.apache.avro-1.11.3.jar

# ── 7. Copy WSO2 MI configuration ───────────────────────────────────────────────
COPY conf/deployment.toml ${MI_HOME}/conf/deployment.toml

# ── 8. Copy all synapse artifacts ────────────────────────────────────────────────
COPY artifacts/local-entries/    ${MI_HOME}/repository/deployment/server/synapse-configs/default/local-entries/
COPY artifacts/apis/             ${MI_HOME}/repository/deployment/server/synapse-configs/default/api/
COPY artifacts/sequences/        ${MI_HOME}/repository/deployment/server/synapse-configs/default/sequences/
COPY artifacts/inbound-endpoints/ ${MI_HOME}/repository/deployment/server/synapse-configs/default/inbound-endpoints/
COPY artifacts/imports/          ${MI_HOME}/repository/deployment/server/synapse-configs/default/imports/
RUN chown -R wso2carbon:wso2carbon ${MI_HOME}/repository/deployment/server/synapse-configs/default/

# ── 9. Switch to wso2carbon user ────────────────────────────────────────────────
USER wso2carbon

EXPOSE 8290 8253 9164

CMD ["/home/wso2carbon/wso2mi-4.4.0/bin/micro-integrator.sh"]
