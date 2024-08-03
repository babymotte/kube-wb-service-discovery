import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { connect, Worterbuch } from "worterbuch-js";

const PREFIX = process.env.KUBERNETES_WB_PREFIX || "kubernetes/services";

async function getClusterIp(k8sApi: CoreV1Api): Promise<string | undefined> {
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

async function publishNodePorts(
  k8sApi: CoreV1Api,
  namespace: string,
  wb: Worterbuch
) {
  const svcRes = await k8sApi.listNamespacedService(namespace);

  const clusterIp = await getClusterIp(k8sApi);
  if (!clusterIp) {
    return;
  }

  for (const item of svcRes.body.items) {
    if (item.metadata?.namespace && item.metadata?.name && item.spec?.ports) {
      for (const port of item.spec?.ports) {
        if (port.name) {
          if (port.nodePort) {
            console.info(
              `Found NodePort service endpoint for ${item.metadata?.name}:`,
              `${port.name}://${clusterIp}:${port.nodePort}`
            );

            wb.set(
              `${PREFIX}/${item.metadata?.namespace}/${item.metadata?.name}/${port.name}`,
              `${port.name}://${clusterIp}:${port.nodePort}`
            );
          }
        }
      }
    }
  }
}

const main = async () => {
  // TODO get wb addrss from env
  const wb = await connect("tcp://worterbuch.homelab:30090");

  const stop = (status: number) => {
    wb.close();
    process.exit(status);
  };

  try {
    const k8sApi = getK8sApi();
    //   const namespaces = await getNamespaces(k8sApi);

    await publishNodePorts(k8sApi, "default", wb);
  } catch (err: any) {
    if (err.message) {
      console.error(err);
    } else {
      console.error(err);
    }
    stop(1);
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

function getK8sApi(): CoreV1Api {
  const kc = new KubeConfig();

  if (process.env.KUBE_API_FROM_CLUSTER === "true") {
    console.info("Loading k8s config from cluster");
    kc.loadFromCluster();
  } else {
    console.info("Loading k8s config from default");
    kc.loadFromDefault();
  }
  const k8sApi = kc.makeApiClient(CoreV1Api);
  return k8sApi;
}
