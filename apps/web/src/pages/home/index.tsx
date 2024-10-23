import { useEffect, useState } from "react"

import { useUserStoreShallow } from "@refly-packages/ai-workspace-common/stores/user"
import { WriteGuide } from "@refly-packages/ai-workspace-common/components/home-page/write-guide"
import { Button, Modal } from "@arco-design/web-react"
import { useSearchParams } from "react-router-dom"

import { LoginModal } from "@/components/login-modal"

import "./index.scss"
import Logo from "@/assets/logo.svg"

const Home = () => {
  const userStore = useUserStoreShallow(state => ({
    userProfile: state.userProfile,
  }))
  const [loginModalVisible, setLoginModalVisible] = useState(false)
  const [searchParams] = useSearchParams()
  const isFromExtension = searchParams.get("from") === "refly-extension-login"

  // Check if the login is from the extension page, set a flag, and control the state based on this flag
  useEffect(() => {
    if (isFromExtension) {
      // If from the extension, set the login status to true
      localStorage.setItem("refly-login-status", "true")
    } else {
      // If not opened from the extension, clear the status to differentiate between extension and normal page
      localStorage.removeItem("refly-login-status")
    }
  }, [isFromExtension])

  if (!userStore.userProfile) {
    return (
      <Modal
        className="landing-modal"
        visible={true}
        footer={null}
        autoFocus={false}
        focusLock={true}
        closable={false}>
        <div className="h-full">
          <div className="landing-modal-login">
            <div className="logo">
              <img src={Logo} alt="Refly" />
              <span>Refly </span>
            </div>

            <Button
              className="login-btn"
              type="primary"
              onClick={() => setLoginModalVisible(true)}>
              Login
            </Button>
          </div>
          <WriteGuide isLogin={false} />
          <LoginModal visible={loginModalVisible} from="extension-login" />
        </div>
      </Modal>
    )
  }

  return <WriteGuide isLogin={true} />
}

export default Home
