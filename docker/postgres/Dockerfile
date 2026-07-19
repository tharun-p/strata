FROM postgres:17-alpine

LABEL org.opencontainers.image.title="Strata PostgreSQL development fixture"
LABEL org.opencontainers.image.description="Three-database PostgreSQL fixture for exercising Strata's catalog and investigation workflows"

COPY init/ /docker-entrypoint-initdb.d/

