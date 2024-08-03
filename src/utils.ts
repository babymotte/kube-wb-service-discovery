import { CoreV1Api, KubeConfig, Watch } from "@kubernetes/client-node";
import { Worterbuch } from "worterbuch-js";

function kubeConfig(): KubeConfig {
  const kc = new KubeConfig();

  if (process.env.KUBE_API_FROM_CLUSTER === "true") {
    console.info("Loading k8s config from cluster");
    kc.loadFromCluster();
  } else {
    console.info("Loading k8s config from default");
    kc.loadFromDefault();
  }

  return kc;
}

export function kubeApi(): CoreV1Api {
  const kc = kubeConfig();
  const k8sApi = kc.makeApiClient(CoreV1Api);

  return k8sApi;
}

export function kubeWatch(): Watch {
  const kc = kubeConfig();
  return new Watch(kc);
}

export function child(object: any, field: string, init?: () => any) {
  let ch = object[field];
  if (ch === undefined) {
    ch = init ? init() : {};
    object[field] = ch;
  }
  return ch;
}

export function resolveChild(object: any, path: string[], init?: () => any) {
  if (path.length === 0) {
    return undefined;
  }
  if (path.length === 1) {
    return child(object, path[0], init);
  }
  const next = path.shift();
  if (next != null) {
    const ch = child(object, next);
    return resolveChild(ch, path, init);
  } else {
    return undefined;
  }
}

export function insertChild(object: any, path: string[], value: any) {
  if (path.length === 0) {
    return;
  }
  if (path.length === 1) {
    object[path[0]] = value;
    return;
  }
  const next = path.shift();
  if (next != null) {
    const ch = child(object, next);
    return insertChild(ch, path, value);
  }
}

export function deleteChild(object: any, path: string[]) {
  if (path.length === 0) {
    return;
  }
  if (path.length === 1) {
    delete object[path[0]];
    return;
  }
  const next = path.shift();
  if (next != null) {
    const ch = child(object, next);
    return deleteChild(ch, path);
  }
}

export function publishObject(prefix: string, object: any, wb: Worterbuch) {
  if (typeof object === "function") {
    throw new Error("cannot publish functions");
  }

  if (object === undefined) {
    wb.delete(prefix);
    return;
  }

  // TODO publish arrays as indexes?
  if (
    object === null ||
    typeof object === "string" ||
    typeof object === "number" ||
    typeof object === "boolean"
    // || Array.isArray(object)
  ) {
    wb.set(prefix, object);
    return;
  }

  if (typeof object === "object") {
    for (const key of Object.keys(object)) {
      publishObject(prefix + "/" + key, object[key], wb);
    }
    return;
  }

  console.log("Warning, parts of object were not published:", object);
}
