export interface LivePageState {
  owner: string
  leafId: string
  url: string
  title: string
  loading: boolean
  error?: string
  visible: boolean
  popout: boolean
  frame?: string
}
