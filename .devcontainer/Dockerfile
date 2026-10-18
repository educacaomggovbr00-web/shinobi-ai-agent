# Debian includes Firefox ESR as a normal apt package (no Snap dependency).
FROM mcr.microsoft.com/devcontainers/base:bookworm

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       firefox-esr \
       fonts-noto-color-emoji \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
