# Isolated Podman Development Environment
# Ubuntu 24.04 LTS with Node.js 22.x, Podman, and OpenCode CLI

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=development
ENV PORT=4098

# Install base dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    git \
    gnupg2 \
    apt-transport-https \
    software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22.x via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && node --version

# Verify Node.js version meets requirement (22.23.1+)
RUN node --version | grep -qE "^v22\.(2[3-9]|[3-9][0-9])\." || \
    (echo "ERROR: Node.js version must be 22.23.1 or higher" && exit 1)

# Install Podman from GitHub releases (Kubic repos for Ubuntu 24.04 are unavailable)
ENV PODMAN_VERSION=6.0.0
RUN curl -fsSL "https://github.com/containers/podman/releases/download/v${PODMAN_VERSION}/podman-remote-static-linux_amd64.tar.gz" \
    -o /tmp/podman.tar.gz \
    && tar -xzf /tmp/podman.tar.gz -C /tmp \
    && mv /tmp/bin/podman-remote-static-linux_amd64 /usr/local/bin/podman \
    && chmod +x /usr/local/bin/podman \
    && rm -rf /tmp/podman.tar.gz /tmp/bin \
    && podman --version

# Install OpenCode CLI via npm (latest version with serve command)
RUN npm install -g opencode-ai \
    && opencode --version

# Create workspace directory
RUN mkdir -p /workspace
WORKDIR /workspace

# Copy entrypoint script
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Create OpenCode config directory
RUN mkdir -p /root/.config/opencode

# Environment variables for runtime (proxy, app config)
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV http_proxy=${HTTP_PROXY}
ENV https_proxy=${HTTPS_PROXY}
ENV NO_PROXY=${NO_PROXY}
ENV no_proxy=${NO_PROXY}

# Expose OpenCode CLI server port
EXPOSE 4098

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/bin/bash"]