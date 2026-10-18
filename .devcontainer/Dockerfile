# Shinobi Cloud Browser — desktop Linux + Firefox + GitHub command bridge.
FROM mcr.microsoft.com/devcontainers/base:bookworm

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       firefox-esr \
       fonts-noto-color-emoji \
       gh \
       xdotool \
       xclip \
       scrot \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
