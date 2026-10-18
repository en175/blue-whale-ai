import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('rocketmq-client-nodejs'));
const grpc = sdkRequire('@grpc/grpc-js');
const { MessagingServiceService } = require('rocketmq-client-nodejs/proto/apache/rocketmq/v2/service_grpc_pb.js');
const pb = require('rocketmq-client-nodejs/proto/apache/rocketmq/v2/service_pb.js');
const def = require('rocketmq-client-nodejs/proto/apache/rocketmq/v2/definition_pb.js');
const { mode, port, routePort, log } = JSON.parse(process.argv[2]);
const record = name => appendFileSync(log, name + '\n');
const ok = () => new def.Status().setCode(def.Code.OK);
const server = new grpc.Server();
server.addService(MessagingServiceService, {
  queryRoute(call, callback) {
    record('route:' + call.request.getTopic().getName());
    if (mode === 'route-timeout') return;
    if (mode === 'route-fail') return callback(null, new pb.QueryRouteResponse().setStatus(new def.Status().setCode(def.Code.TOPIC_NOT_FOUND)));
    const endpoints = new def.Endpoints().setScheme(def.AddressScheme.IPV4)
      .addAddresses(new def.Address().setHost('127.0.0.1').setPort(routePort));
    const broker = new def.Broker().setName('isolated').setId(0).setEndpoints(
      new def.Endpoints().setScheme(def.AddressScheme.IPV4).setAddressesList([endpoints]));
    const queue = new def.MessageQueue().setId(0).setBroker(broker).setTopic(call.request.getTopic())
      .setPermission(def.Permission.READ_WRITE).setAcceptMessageTypesList([def.MessageType.NORMAL]);
    callback(null, new pb.QueryRouteResponse().setStatus(ok()).setMessageQueuesList([queue]));
  },
  telemetry(call) {
    record('telemetry');
    call.on('error', () => {});
    call.on('data', command => {
      if (mode !== 'handshake-timeout') {
        command.getSettings().setBackoffPolicy(new def.RetryPolicy().setMaxAttempts(1)
          .setExponentialBackoff(new def.ExponentialBackoff().setMultiplier(1)));
        call.write(command);
      }
    });
    call.on('end', () => call.end());
  },
  heartbeat(call, callback) {
    record('heartbeat');
    callback(null, new pb.HeartbeatResponse().setStatus(ok()));
  },
  notifyClientTermination(call, callback) {
    record('close');
    callback(null, new pb.NotifyClientTerminationResponse().setStatus(ok()));
  },
  sendMessage(call, callback) {
    record('UNEXPECTED_SEND');
    callback({ code: grpc.status.PERMISSION_DENIED });
  },
});
server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), error => {
  if (error) throw error;
  console.log('READY');
});
process.on('SIGTERM', () => { server.forceShutdown(); process.exit(0); });
