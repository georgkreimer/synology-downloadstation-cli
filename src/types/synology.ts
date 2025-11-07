export interface SynologyResponse<T> {
  success: boolean
  data?: T
  error?: SynologyError
}

export interface SynologyError {
  code: number
  errors?: TaskOperationError
}

export interface AuthData {
  account?: string
  device_id?: string
  sid: string
  synotoken?: string
}

export interface TasksResponse {
  offset: number
  total: number
  task: Task[]
}

export interface TaskInfoResponse {
  task: Task[]
}

export interface Task {
  id: string
  username: string
  type: string
  title: string
  size: number
  status: TaskStatusCode
  status_extra?: StatusExtra
  additional?: AdditionalTaskInfo
}

export interface StatusExtra {
  error_detail?: string
  unzip_progress?: number
}

export interface AdditionalTaskInfo {
  detail?: Detail
  transfer?: Transfer
}

export interface Detail {
  destination?: string
  completed_time?: number
  created_time?: number
  started_time?: number
  uri?: string
}

export interface Transfer {
  downloaded_pieces?: number
  size_downloaded: number
  size_uploaded?: number
  speed_download: number
  speed_upload?: number
}

export interface TaskOperation {
  failed_task?: FailedTask[]
}

export interface FailedTask {
  id: string
  error: number
}

export interface TaskOperationError {
  list_id?: string[]
  task_id?: string[]
}

export type TaskStatusCode =
  | 1 // waiting
  | 2 // downloading
  | 3 // paused
  | 4 // finishing
  | 5 // finished
  | 6 // hash checking
  | 7 // pre-seeding
  | 8 // seeding
  | 9 // filehostingWaiting
  | 10 // extracting
  | 11 // preprocessing
  | 12 // preprocess pass
  | 13 // downloaded
  | 14 // postprocessing
  | 15 // captcha needed
  | (101 | 102 | 103 | 104 | 105 | 106 | 107 | 108 | 109 | 110 | 111 | 112 | 113 | 114 | 115 | 116 | 117 | 118 | 119 | 120 | 121 | 122 | 123 | 124 | 125 | 126 | 127 | 128 | 129 | 130 | 131 | 132 | 133 | 134)
  | number
