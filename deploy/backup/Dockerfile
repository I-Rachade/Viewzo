FROM postgres:16-alpine
RUN apk add --no-cache aws-cli
COPY backup.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["entrypoint.sh"]
