/**
 *  Copyright (C) 2024 Michael Bachmann
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { KubeConfig, CoreV1Api, Watch } from "@kubernetes/client-node";
import { connect, Worterbuch } from "worterbuch-js";
import {
  deleteChild,
  insertChild,
  kubeApi,
  kubeWatch,
  publishObject,
  resolveChild,
} from "./utils";

const WB_HOST = process.env.WORTERBUCH_HOST_ADDRESS || "worterbuch.homelab";
const WB_PORT = process.env.WORTERBUCH_PORT || "30090";
const PREFIX = process.env.KUBERNETES_WB_PREFIX || "kubernetes/services";

const SERVICES = {};

async function getClusterIp(): Promise<string | undefined> {
  const k8sApi = kubeApi();

  // TODO try to get kube-vip

  const nodeRes = await k8sApi.listNode();
  for (const item of nodeRes.body.items) {
    if (item.status?.addresses) {
      for (const addr of item.status.addresses) {
        if (addr.address && addr.type === "InternalIP") {
          return addr.address;
        }
      }
    }
  }

  return undefined;
}

async function watchNodePorts(
  namespace: string,
  wb: Worterbuch
): Promise<() => void> {
  const clusterIp = await getClusterIp();
  if (!clusterIp) {
    return () => {};
  }

  let resourceVersion = 0;
  let restartWatch = true;
  const stopRef: { current: (() => void) | null } = { current: null };
  const renewWatchRef: { current: (() => void) | null } = { current: null };

  const watch = kubeWatch();

  const stopWatch = () => {
    restartWatch = false;
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
  };

  renewWatchRef.current = async () => {
    stopWatch();

    const req = await watch.watch(
      "/api/v1/services",
      // optional query parameters can go here.
      {
        allowWatchBookmarks: true,
      },
      // callback is called for each received object.
      (type, apiObj, watchObj) => {
        if (type === "BOOKMARK") {
          console.log("watchObj", watchObj);
          if (watchObj?.object?.metadata?.resourceVersion) {
            resourceVersion = watchObj.object.metadata.resourceVersion;
            console.log(`resourceVersion:`, resourceVersion);
          }
          return;
        }

        if (
          (type === "MODIFIED" || type === "DELETED") &&
          apiObj.metadata?.namespace === namespace &&
          apiObj.metadata?.name
        ) {
          deleteChild(SERVICES, [
            apiObj.metadata.namespace,
            apiObj.metadata.name,
            "nodePort",
          ]);
        }

        if (
          apiObj.metadata?.namespace === namespace &&
          apiObj.metadata?.name &&
          apiObj.spec?.ports
        ) {
          for (const port of apiObj.spec.ports) {
            if (port.name) {
              if (port.nodePort) {
                if (type === "ADDED" || type === "MODIFIED") {
                  console.info(
                    `Found NodePort service endpoint for ${apiObj.metadata.name}:`,
                    `${port.name}://${clusterIp}:${port.nodePort}`
                  );

                  insertChild(
                    SERVICES,
                    [
                      apiObj.metadata.namespace,
                      apiObj.metadata.name,
                      "nodePort",
                      port.name,
                    ],
                    [`${port.name}://${clusterIp}:${port.nodePort}`]
                  );
                }
              }
            }
          }
        }

        wb.pDelete(PREFIX + "/#");
        publishObject(PREFIX, SERVICES, wb);
      },
      // done callback is called if the watch terminates normally
      (err) => {
        if (restartWatch && renewWatchRef.current) {
          renewWatchRef.current();
        }
        console.error(err);
      }
    );

    stopWatch();
    stopRef.current = () => {
      console.info("stopping watch");
      req.abort();
    };
  };

  renewWatchRef.current();

  return stopWatch;
}

async function watchIngresses(
  namespace: string,
  wb: Worterbuch
): Promise<() => void> {
  const clusterIp = await getClusterIp();
  if (!clusterIp) {
    return () => {};
  }

  let resourceVersion = 0;
  let restartWatch = true;
  const stopRef: { current: (() => void) | null } = { current: null };
  const renewWatchRef: { current: (() => void) | null } = { current: null };

  const watch = kubeWatch();

  const stopWatch = () => {
    restartWatch = false;
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
  };

  renewWatchRef.current = async () => {
    stopWatch();

    const req = await watch.watch(
      `/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses`,
      // optional query parameters can go here.
      {
        allowWatchBookmarks: true,
      },
      // callback is called for each received object.
      (type, apiObj, watchObj) => {
        if (type === "BOOKMARK") {
          console.log("watchObj", watchObj);
          if (watchObj?.object?.metadata?.resourceVersion) {
            resourceVersion = watchObj.object.metadata.resourceVersion;
            console.log(`resourceVersion:`, resourceVersion);
          }
          return;
        }

        if (
          apiObj.metadata?.namespace === namespace &&
          apiObj.metadata?.name &&
          apiObj.spec?.rules
        ) {
          if (type === "MODIFIED" || type === "DELETED") {
            for (const rule of apiObj.spec.rules) {
              for (const protoName of Object.keys(rule)) {
                const proto = rule[protoName];
                if (proto.paths) {
                  for (const pathDef of proto.paths) {
                    if (pathDef.path && pathDef.backend?.service?.name) {
                      const port =
                        pathDef.backend.service.port?.name || protoName;
                      const serviceName = pathDef.backend.service.name;
                      deleteChild(SERVICES, [
                        namespace,
                        serviceName,
                        "ingress",
                        port,
                      ]);
                    }
                  }
                }
              }
            }
          }
          if (type === "ADDED" || type === "MODIFIED") {
            for (const rule of apiObj.spec.rules) {
              let host = rule.host || clusterIp;
              for (const protoName of Object.keys(rule)) {
                const proto = rule[protoName];
                if (proto.paths) {
                  for (const pathDef of proto.paths) {
                    if (pathDef.path && pathDef.backend?.service?.name) {
                      const port =
                        pathDef.backend.service.port?.name || protoName;
                      const serviceName = pathDef.backend.service.name;
                      const url = `${port}://${host}${pathDef.path}`;
                      const endpoints = resolveChild(
                        SERVICES,
                        [namespace, serviceName, "ingress", port],
                        () => []
                      );
                      endpoints.push(url);
                    }
                  }
                }
              }
            }
          }
        }

        wb.pDelete(PREFIX + "/#");
        publishObject(PREFIX, SERVICES, wb);
      },
      // done callback is called if the watch terminates normally
      (err) => {
        if (restartWatch && renewWatchRef.current) {
          renewWatchRef.current();
        }
        console.error(err);
      }
    );

    stopWatch();
    stopRef.current = () => {
      console.info("stopping watch");
      req.abort();
    };
  };

  renewWatchRef.current();

  return stopWatch;
}

const main = async () => {
  // TODO get wb addrss from env
  const wb = await connect(`tcp://${WB_PORT}:${WB_PORT}`);

  wb.setGraveGoods([PREFIX + "/#"]);

  try {
    // await publishNodePorts("default", wb);
    const stopNodePortWatch = await watchNodePorts("default", wb);
    const stopIngressWatch = await watchIngresses("default", wb);

    const stop = () => {
      wb.close();
      stopNodePortWatch();
      stopIngressWatch();
      process.exit(0);
    };

    process.on("SIGINT", stop);
    process.on("SIGHUP", stop);
    process.on("SIGTERM", stop);
  } catch (err: any) {
    if (err.message) {
      console.error(err);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
};

main();

async function getNamespaces(k8sApi: CoreV1Api): Promise<string[]> {
  const namespaces: string[] = [];

  const namespRes = await k8sApi.listNamespace();
  for (const nspc of namespRes.body.items) {
    if (nspc.status?.phase === "Active" && nspc.metadata?.name) {
      namespaces.push(nspc.metadata.name);
    }
  }

  return namespaces;
}
