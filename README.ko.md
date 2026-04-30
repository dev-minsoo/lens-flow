# Lens Flow

[![Release](https://img.shields.io/github/v/release/dev-minsoo/lens-flow?display_name=tag)](https://github.com/dev-minsoo/lens-flow/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/dev-minsoo/lens-flow/ci.yml?branch=main&label=ci)](https://github.com/dev-minsoo/lens-flow/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/dev-minsoo/lens-flow)](./LICENSE.md)

> README 상단에 스크린샷이나 GIF를 넣으면 좋습니다.
> 권장 경로: `docs/assets/workload-flow-overview.gif`
>
> 예시:
> `![Lens Flow overview](docs/assets/workload-flow-overview.gif)`

Lens Flow는 Lens 계열 앱에서 동작하는 Kubernetes 토폴로지 익스텐션입니다. 클러스터 내부의 진입점, 라우팅 리소스, 워크로드, 워크로드 의존성을 **Workload Monitoring** 페이지에서 그래프로 보여줍니다.

이 프로젝트는 Argo CD의 Tree, Network 그래프 뷰에서 리소스 관계를 파악하던 경험에서 영감을 받았고, 그것을 Lens 계열 데스크톱 클라이언트 안에서 Kubernetes workload 중심 토폴로지로 풀어낸 형태입니다.

Kubernetes에서는 Ingress, Service, workload, ReplicaSet, Pod, ConfigMap, Secret, PVC 같은 관계가 여러 화면에 흩어져 있어서, 변경 하나를 이해하려면 이 화면 저 화면을 계속 오가게 됩니다. Lens Flow는 그 관계를 한 화면으로 모아서 라우팅, ownership, dependency를 더 빠르게 추적할 수 있게 하는 데 목적이 있습니다.

## 다운로드

- [최신 릴리즈 열기](https://github.com/dev-minsoo/lens-flow/releases/latest)
- 해당 릴리즈에 첨부된 `lens-flow-*.tgz` asset을 다운로드
- Lens, OpenLens, FreeLens의 Extensions 화면에서 다운로드한 `.tgz` 설치

릴리즈는 `main`에 포함된 커밋에 대해 `vX.Y.Z` 태그를 푸시했을 때 생성됩니다.

다음 같은 상황을 빠르게 파악하는 데 목적이 있습니다.

- 이 Ingress가 어떤 Service로 연결되는가
- 이 Service 뒤에 실제로 어떤 workload가 있는가
- 이 Deployment 아래에 어떤 ReplicaSet과 Pod가 있는가
- 이 workload가 어떤 ConfigMap, Secret, PVC를 사용하는가

## 지원 앱

- Lens 6+
- OpenLens 6+
- FreeLens 6+

이 익스텐션은 Lens renderer API를 사용하며, 별도 바이너리나 사이드카를 요구하지 않습니다.

## 주요 기능

- Internet, LoadBalancer, Ingress, Service, Deployment, ReplicaSet, StatefulSet, DaemonSet, Pod, ConfigMap, Secret, PVC 노드 표시
- Ingress `defaultBackend` 지원
- Ingress가 없어도 외부 `LoadBalancer` Service 표시
- Pod owner chain 해석:
  `Deployment -> ReplicaSet -> Pod`
- StatefulSet과 Pod, 생성된 PVC 관계 표시
- pod template의 `env`, `envFrom`, `volumes`를 읽어 workload dependency edge 생성
- `All`, `None`, `Reset`이 포함된 Resource 패널
- `Left to right`, `Top to bottom` 레이아웃 모드
- Minimap, controls 토글
- edge hover 시 연결된 노드 강조
- 클러스터별 namespace 저장
- 클러스터 공통 resource visibility 저장
- 카드 클릭 시 Lens details pane 열기

## 기본 표시 리소스

기본 visible resource는 다음과 같습니다.

- Internet
- LoadBalancer
- Ingress
- Service
- Deployment
- ReplicaSet
- Pod

Resource 패널의 `Reset`은 이 기본값으로 되돌립니다.

## 설정 저장

설정 파일은 다음 경로에 저장됩니다.

```text
~/.k8slens/lens-flow/settings.json
```

저장 규칙:

- `namespace`는 클러스터별 저장
- `resource visibility`, `direction`, `minimap`, `controls`는 전역 공통 저장

클러스터 식별 키 우선순위는 다음과 같습니다.

1. `kubeconfigContext`
2. Lens cluster entity id
3. Lens cluster display name
4. `default`

즉 가능하면 사람이 읽을 수 있는 context 이름을 우선 사용하고, 기존 저장값 호환을 위해 fallback도 같이 유지합니다.

## 설치

### GitHub Releases에서 설치

1. [최신 릴리즈](https://github.com/dev-minsoo/lens-flow/releases/latest)를 엽니다.
2. 첨부된 `lens-flow-*.tgz` asset을 다운로드합니다.
3. Lens, OpenLens, FreeLens를 엽니다.
4. Extensions 화면으로 이동합니다.
5. 다운로드한 `.tgz`를 설치합니다.

### 로컬에서 `.tgz` 생성 후 설치

```sh
npm install
npm run build
npm pack
```

그 후 생성된 `lens-flow-<version>.tgz`를 Extensions 화면에서 설치하면 됩니다.

### 개발 중 소스에서 설치

```sh
npm install
npm run build
```

그 후 Extensions 화면에서 프로젝트 디렉터리를 로드하면 됩니다.

## 사용 방법

1. 클러스터를 엽니다.
2. 좌측 메뉴에서 **Workload Monitoring**으로 이동합니다.
3. Namespace selector에서 네임스페이스를 선택합니다.
4. **Resources** 패널에서 표시할 리소스를 고릅니다.
5. Resource 패널 변경은 `Apply`를 눌러야 반영됩니다.
6. edge에 마우스를 올리면 연결된 노드가 강조됩니다.
7. 리소스 카드를 클릭하면 기본 details pane이 열립니다.

## 그래프 생성 방식

Lens Flow는 Lens store에서 리소스를 읽고, 아래 단계로 그래프를 만듭니다.

1. 리소스/관계 수집
2. `dagre` 기반 방향성 레이아웃
3. ReplicaSet 정렬, disconnected group 보정, 카드 충돌 완화 같은 후처리

Service target 해석 순서는 다음과 같습니다.

1. Endpoints 데이터
2. Pod selector matching
3. Workload template selector matching

## 알려진 제한사항

- 리소스가 매우 많거나 토폴로지가 복잡하면 edge 라우팅이 완벽하지 않을 수 있습니다.
- 현재 레이아웃은 best-effort 방식이며, 완전한 constraint-based graph router는 아닙니다.
- Lens 계열 앱/버전별로 런타임 동작 차이가 약간 있을 수 있습니다.
- 특정 리소스 kind store가 앱에서 제공되지 않으면 일부 노드가 비어 보일 수 있습니다.

레이아웃 이슈를 제보할 때는 리소스 구성과 스크린샷을 같이 주는 것이 가장 도움이 됩니다.

## 개발

```sh
npm install
npm run start
```

주요 명령:

- `npm run start` - webpack watch
- `npm run build` - production build
- `npm test` - graph/settings 테스트
- `npm pack` - 설치 가능한 `.tgz` 생성

## 릴리즈 흐름

1. `package.json` 버전을 목표 버전으로 올립니다
2. 그 변경을 `main`에 반영합니다
3. `v1.0.0` 같은 동일한 버전 태그를 생성해서 푸시합니다
4. GitHub Actions가 테스트, 빌드, `lens-flow-<version>.tgz` 생성, GitHub Release 생성 또는 갱신까지 수행합니다

## 프로젝트 구조

- `renderer.tsx` - cluster page와 메뉴 등록
- `main.ts` - main extension entrypoint
- `components/WorkloadFlowPage.tsx` - 상단 toolbar와 settings UI
- `components/WorkloadFlow.tsx` - Lens store를 React Flow에 연결
- `components/workloadFlowPageSettings.ts` - 설정 저장/파싱 처리
- `graph/buildGraph.ts` - 토폴로지 그래프 생성과 레이아웃
- `graph/types.ts` - 그래프 및 Kubernetes 유사 타입 정의
- `tests/buildGraph.test.ts` - 그래프 생성과 설정 파싱 테스트

## License

MIT
