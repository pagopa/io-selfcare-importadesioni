FROM node:10.14.1@sha256:262a3b968df75a8867e72b483a63cc6b62ef63f7a251770dea9fcc37d31a9877

WORKDIR /usr/src/app

RUN npm i -g azure-functions-core-tools@2 --unsafe-perm true

ENV AzureWebJobsScriptRoot=/usr/src/app \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true

CMD ["func", "start", "--javascript"]
