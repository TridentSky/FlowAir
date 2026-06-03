import threading


class OBSController:
    def __init__(self):
        self.client = None
        self.connected = False
        self.settings = {
            "enabled": False,
            "host": "localhost",
            "port": 4455,
            "password": ""
        }
        self.lock = threading.Lock()

    def connect(self):
        with self.lock:
            try:
                if self.client:
                    try:
                        self.client.disconnect()
                    except:
                        pass
                    self.client = None

                import obsws_python as obs
                kwargs = {
                    "host": self.settings.get("host", "localhost"),
                    "port": self.settings.get("port", 4455),
                    "timeout": 3
                }
                password = self.settings.get("password", "")
                if password:
                    kwargs["password"] = password

                self.client = obs.ReqClient(**kwargs)
                resp = self.client.get_version()
                self.connected = True
                return {"success": True, "obs_version": resp.obs_version}
            except Exception as e:
                self.client = None
                self.connected = False
                return {"success": False, "error": str(e)}

    def disconnect(self):
        with self.lock:
            try:
                if self.client:
                    try:
                        self.client.disconnect()
                    except:
                        pass
                    self.client = None
                self.connected = False
                return {"success": True}
            except Exception as e:
                self.connected = False
                self.client = None
                return {"success": False, "error": str(e)}

    def is_alive(self):
        with self.lock:
            if not self.client:
                self.connected = False
                return False
            try:
                self.client.get_version()
                self.connected = True
                return True
            except:
                self.connected = False
                self.client = None
                return False

    def get_scenes(self):
        with self.lock:
            if not self.connected or not self.client:
                return []
            try:
                resp = self.client.get_scene_list()
                raw = resp.__dict__ if hasattr(resp, '__dict__') else {}
                scene_list = raw.get('scenes', [])
                if not scene_list:
                    for key, val in raw.items():
                        if isinstance(val, list):
                            scene_list = val
                            break
                scenes = []
                for scene in scene_list:
                    if isinstance(scene, dict):
                        name = scene.get("sceneName", scene.get("scene_name", ""))
                    else:
                        name = getattr(scene, 'sceneName', getattr(scene, 'scene_name', str(scene)))
                    if name:
                        scenes.append(name)
                return scenes
            except:
                return []

    def get_scene_sources(self, scene_name):
        with self.lock:
            if not self.connected or not self.client:
                return []
            try:
                resp = self.client.get_scene_item_list(name=scene_name)
                raw = resp.__dict__ if hasattr(resp, '__dict__') else {}
                item_list = []
                for key, val in raw.items():
                    if isinstance(val, list):
                        item_list = val
                        break
                sources = []
                for item in item_list:
                    try:
                        if isinstance(item, dict):
                            d = item
                        elif hasattr(item, '__dict__'):
                            d = item.__dict__
                        else:
                            continue
                        name = ""
                        item_id = 0
                        enabled = False
                        for k, v in d.items():
                            kl = k.lower().replace('_', '')
                            if kl == 'sourcename':
                                name = str(v)
                            elif kl == 'sceneitemid':
                                item_id = int(v) if v else 0
                            elif kl == 'sceneitemenabled':
                                enabled = bool(v)
                        if name:
                            sources.append({
                                "sourceName": name,
                                "sceneItemId": item_id,
                                "sceneItemEnabled": enabled
                            })
                    except:
                        continue
                return sources
            except:
                return []

    def set_source_visibility(self, scene_name, source_name, visible):
        with self.lock:
            if not self.connected or not self.client:
                return {"success": False, "error": "Not connected"}
            try:
                resp = self.client.get_scene_item_id(
                    scene_name=scene_name,
                    source_name=source_name
                )
                scene_item_id = resp.scene_item_id
                self.client.set_scene_item_enabled(
                    scene_name=scene_name,
                    item_id=scene_item_id,
                    enabled=visible
                )
                return {"success": True}
            except Exception as e:
                return {"success": False, "error": str(e)}

    def get_current_scene(self):
        with self.lock:
            if not self.connected or not self.client:
                return None
            try:
                resp = self.client.get_current_program_scene()
                raw = resp.__dict__ if hasattr(resp, '__dict__') else {}
                for k, v in raw.items():
                    kl = k.lower().replace('_', '')
                    if kl in ('currentprogramscenename', 'scenename') and v:
                        return str(v)
                return None
            except:
                return None

    def set_current_scene(self, scene_name):
        with self.lock:
            if not self.connected or not self.client:
                return {"success": False, "error": "Not connected"}
            try:
                self.client.set_current_program_scene(scene_name)
                return {"success": True}
            except Exception as e:
                return {"success": False, "error": str(e)}

    def get_transitions(self):
        with self.lock:
            if not self.connected or not self.client:
                return {"transitions": [], "current": None, "duration": None}
            try:
                resp = self.client.get_scene_transition_list()
                raw = resp.__dict__ if hasattr(resp, '__dict__') else {}
                transitions = []
                current = None
                for k, v in raw.items():
                    kl = k.lower().replace('_', '')
                    if isinstance(v, list):
                        for t in v:
                            td = t if isinstance(t, dict) else getattr(t, '__dict__', {})
                            for tk, tv in td.items():
                                if tk.lower().replace('_', '') == 'transitionname' and tv:
                                    transitions.append(str(tv))
                    elif kl == 'currentscenetransitionname' and v:
                        current = str(v)
                return {"transitions": transitions, "current": current}
            except:
                return {"transitions": [], "current": None}

    def set_transition(self, transition_name, duration_ms=None):
        with self.lock:
            if not self.connected or not self.client:
                return {"success": False, "error": "Not connected"}
            try:
                if transition_name:
                    self.client.set_current_scene_transition(transition_name)
                if duration_ms:
                    self.client.set_current_scene_transition_duration(int(duration_ms))
                return {"success": True}
            except Exception as e:
                return {"success": False, "error": str(e)}

    def execute_obs_event(self, item):
        action = item.get("obs_action")
        scene = item.get("obs_scene")

        if action == "switch_scene":
            transition = item.get("obs_transition")
            duration = item.get("obs_transition_duration")
            if transition or duration:
                self.set_transition(transition, duration)
            if scene:
                self.set_current_scene(scene)
            return

        if action in ("show", "hide"):
            self.set_source_visibility(scene, item.get("obs_source"), action == "show")
